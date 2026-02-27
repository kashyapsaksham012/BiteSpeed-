import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getConnection } from "../db/mysql";
import { ContactRow, IdentifyResponse } from "../types/contact";

type ContactRecord = ContactRow & RowDataPacket;

const getCreatedAtMs = (value: Date | string): number => {
  if (value instanceof Date) {
    return value.getTime();
  }
  return new Date(value).getTime();
};

const sortByCreatedAt = (a: ContactRecord, b: ContactRecord): number => {
  const diff = getCreatedAtMs(a.createdAt) - getCreatedAtMs(b.createdAt);
  return diff !== 0 ? diff : a.id - b.id;
};

const buildIdentifyResponse = (
  primaryId: number,
  contacts: ContactRecord[]
): IdentifyResponse => {
  const sorted = [...contacts].sort(sortByCreatedAt);
  const primary = sorted.find((contact) => contact.id === primaryId) ?? null;

  const emails: string[] = [];
  const phoneNumbers: string[] = [];
  const secondaryContactIds: number[] = [];
  const emailSet = new Set<string>();
  const phoneSet = new Set<string>();

  if (primary?.email) {
    emails.push(primary.email);
    emailSet.add(primary.email);
  }

  if (primary?.phoneNumber) {
    phoneNumbers.push(primary.phoneNumber);
    phoneSet.add(primary.phoneNumber);
  }

  for (const contact of sorted) {
    if (contact.linkPrecedence === "secondary") {
      secondaryContactIds.push(contact.id);
    }

    if (contact.email && !emailSet.has(contact.email)) {
      emails.push(contact.email);
      emailSet.add(contact.email);
    }

    if (contact.phoneNumber && !phoneSet.has(contact.phoneNumber)) {
      phoneNumbers.push(contact.phoneNumber);
      phoneSet.add(contact.phoneNumber);
    }
  }

  return {
    contact: {
      primaryContactId: primaryId,
      emails,
      phoneNumbers,
      secondaryContactIds
    }
  };
};

const selectMatches = async (
  connection: Awaited<ReturnType<typeof getConnection>>,
  email: string | null,
  phoneNumber: string | null
): Promise<ContactRecord[]> => {
  const conditions: string[] = [];
  const params: Array<string> = [];

  if (email) {
    conditions.push("email = ?");
    params.push(email);
  }

  if (phoneNumber) {
    conditions.push("phoneNumber = ?");
    params.push(phoneNumber);
  }

  if (conditions.length === 0) {
    return [];
  }

  const whereClause = conditions.join(" OR ");
  const [rows] = await connection.execute<ContactRecord[]>(
    `SELECT * FROM contacts WHERE deletedAt IS NULL AND (${whereClause}) FOR UPDATE`,
    params
  );

  return rows;
};

const selectRelatedContacts = async (
  connection: Awaited<ReturnType<typeof getConnection>>,
  primaryIds: number[]
): Promise<ContactRecord[]> => {
  if (primaryIds.length === 0) {
    return [];
  }

  const placeholders = primaryIds.map(() => "?").join(", ");
  const [rows] = await connection.execute<ContactRecord[]>(
    `SELECT * FROM contacts
     WHERE deletedAt IS NULL
       AND (id IN (${placeholders}) OR linkedId IN (${placeholders}))
     ORDER BY createdAt ASC, id ASC
     FOR UPDATE`,
    [...primaryIds, ...primaryIds]
  );

  return rows;
};

export const identifyContact = async (
  email: string | null,
  phoneNumber: string | null
): Promise<IdentifyResponse> => {
  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const matches = await selectMatches(connection, email, phoneNumber);

    if (matches.length === 0) {
      const [result] = await connection.execute<ResultSetHeader>(
        "INSERT INTO contacts (phoneNumber, email, linkedId, linkPrecedence) VALUES (?, ?, ?, ?)",
        [phoneNumber, email, null, "primary"]
      );

      const primaryId = result.insertId;
      await connection.commit();

      const newContact = {
        id: primaryId,
        phoneNumber,
        email,
        linkedId: null,
        linkPrecedence: "primary",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null
      } as ContactRecord;

      return buildIdentifyResponse(primaryId, [newContact]);
    }

    // Gather all primary IDs related to the matched contacts.
    const primaryIds = new Set<number>();
    for (const match of matches) {
      if (match.linkPrecedence === "primary") {
        primaryIds.add(match.id);
      } else if (match.linkedId) {
        primaryIds.add(match.linkedId);
      }
    }

    let relatedContacts = await selectRelatedContacts(
      connection,
      Array.from(primaryIds)
    );

    if (relatedContacts.length === 0) {
      throw new Error("Unable to resolve related contacts");
    }

    // Determine the oldest primary; all other primaries will be merged into it.
    const primaryContacts = relatedContacts.filter(
      (contact) => contact.linkPrecedence === "primary"
    );

    const candidatePrimaries = primaryContacts.length > 0
      ? primaryContacts
      : relatedContacts;

    const oldestPrimary = [...candidatePrimaries].sort(sortByCreatedAt)[0];
    const otherPrimaryIds = primaryContacts
      .filter((contact) => contact.id !== oldestPrimary.id)
      .map((contact) => contact.id);

    if (otherPrimaryIds.length > 0) {
      // Merge other primaries into the oldest one and re-point their secondaries.
      const placeholders = otherPrimaryIds.map(() => "?").join(", ");
      await connection.execute(
        `UPDATE contacts
         SET linkPrecedence = "secondary", linkedId = ?
         WHERE id IN (${placeholders})`,
        [oldestPrimary.id, ...otherPrimaryIds]
      );

      await connection.execute(
        `UPDATE contacts
         SET linkedId = ?
         WHERE linkedId IN (${placeholders})`,
        [oldestPrimary.id, ...otherPrimaryIds]
      );
    }

    relatedContacts = await selectRelatedContacts(connection, [oldestPrimary.id]);

    const emailSet = new Set(
      relatedContacts.map((contact) => contact.email).filter(Boolean) as string[]
    );
    const phoneSet = new Set(
      relatedContacts
        .map((contact) => contact.phoneNumber)
        .filter(Boolean) as string[]
    );

    const hasNewEmail = email ? !emailSet.has(email) : false;
    const hasNewPhone = phoneNumber ? !phoneSet.has(phoneNumber) : false;

    if (hasNewEmail || hasNewPhone) {
      // Insert the new information as a secondary contact linked to the primary.
      await connection.execute<ResultSetHeader>(
        "INSERT INTO contacts (phoneNumber, email, linkedId, linkPrecedence) VALUES (?, ?, ?, ?)",
        [phoneNumber, email, oldestPrimary.id, "secondary"]
      );

      relatedContacts = await selectRelatedContacts(connection, [oldestPrimary.id]);
    }

    await connection.commit();

    return buildIdentifyResponse(oldestPrimary.id, relatedContacts);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
