# Identity Reconciliation Service - Architecture & Flow

## Overview

This is a production-ready backend service built with **Node.js, TypeScript, Express, and MySQL** that reconciles customer identities by email and phone number. It consolidates fragmented customer records into a unified view.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Request                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Express Server                             │
│                      (src/server.ts)                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Startup: DB Health Check + Schema Verification           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Middleware                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │ express.json()  │  │ validateIdentify│  │ errorHandler   │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Routes                                  │
│                   POST /identify                                │
│              (src/routes/identifyRoutes.ts)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Controller                               │
│            (src/controllers/identifyController.ts)              │
│         Extracts email & phoneNumber from request body          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Service Layer                            │
│            (src/services/identifyService.ts)                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Core Business Logic (Transaction-Based)                  │  │
│  │  1. Find matching contacts by email/phone                 │  │
│  │  2. Collect all related records (primary + secondaries)   │  │
│  │  3. Determine oldest primary contact                      │  │
│  │  4. Merge multiple primaries if needed                    │  │
│  │  5. Insert new data as secondary if needed                │  │
│  │  6. Build consolidated response                           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Database Layer                             │
│                (src/db/mysql.ts)                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  MySQL Connection Pool + Schema Management                │  │
│  │  - Auto-creates contacts table on startup                 │  │
│  │  - Auto-creates indexes (idx_email, idx_phone, idx_linkedId)││
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Contacts Table

```sql
CREATE TABLE contacts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phoneNumber VARCHAR(20) NULL,
    email VARCHAR(255) NULL,
    linkedId INT NULL,              -- References primary contact id
    linkPrecedence ENUM('primary', 'secondary') NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deletedAt TIMESTAMP NULL,       -- Soft delete support
    FOREIGN KEY (linkedId) REFERENCES contacts(id)
);
```

### Indexes
- `idx_email` - Fast lookup by email
- `idx_phone` - Fast lookup by phone number
- `idx_linkedId` - Fast lookup of secondaries by primary

---

## Core Business Logic Flow

### Request Flow

```
POST /identify
Content-Type: application/json

{
    "email": "user@example.com",
    "phoneNumber": "+1234567890"
}
```

### Step-by-Step Processing

#### Step 1: Validation (Middleware)
```
┌─────────────────────────────────────────────────────────────┐
│ validateIdentify Middleware                                 │
├─────────────────────────────────────────────────────────────┤
│ • Check email is string or null                             │
│ • Check phoneNumber is string or null                       │
│ • Trim whitespace                                           │
│ • Ensure at least one field is provided                     │
│ • Return 400 if validation fails                            │
└─────────────────────────────────────────────────────────────┘
```

#### Step 2: Transaction Start
```
┌─────────────────────────────────────────────────────────────┐
│ Begin MySQL Transaction (FOR UPDATE locks)                  │
│ Purpose: Prevent race conditions during concurrent requests │
└─────────────────────────────────────────────────────────────┘
```

#### Step 3: Find Matching Contacts
```sql
SELECT * FROM contacts 
WHERE deletedAt IS NULL 
  AND (email = ? OR phoneNumber = ?)
FOR UPDATE
```

**Outcomes:**
- **No matches** → Create new primary contact (go to Step 4a)
- **Matches found** → Collect related records (go to Step 4b)

#### Step 4a: New Contact Creation
```
┌─────────────────────────────────────────────────────────────┐
│ No existing match found                                     │
├─────────────────────────────────────────────────────────────┤
│ INSERT INTO contacts (phoneNumber, email, linkedId, linkPrecedence)
│ VALUES (?, ?, NULL, 'primary')                              │
│                                                             │
│ → Returns newly created primary contact                     │
└─────────────────────────────────────────────────────────────┘
```

#### Step 4b: Existing Contact Processing
```
┌─────────────────────────────────────────────────────────────┐
│ Matches found - collect all related records                 │
├─────────────────────────────────────────────────────────────┤
│ 1. Gather all primary IDs:                                  │
│    - If match is primary → add its id                       │
│    - If match is secondary → add its linkedId               │
│                                                             │
│ 2. Fetch all related contacts:                              │
│    SELECT * FROM contacts                                   │
│    WHERE id IN (primaryIds) OR linkedId IN (primaryIds)     │
│    ORDER BY createdAt ASC                                   │
└─────────────────────────────────────────────────────────────┘
```

#### Step 5: Merge Multiple Primaries (if needed)
```
┌─────────────────────────────────────────────────────────────┐
│ Multiple primaries detected - consolidate into one          │
├─────────────────────────────────────────────────────────────┤
│ 1. Sort primaries by createdAt (oldest first)               │
│ 2. Select oldest as the canonical primary                   │
│ 3. Convert newer primaries to secondaries:                  │
│    UPDATE contacts                                          │
│    SET linkPrecedence = 'secondary', linkedId = oldestId    │
│    WHERE id IN (otherPrimaryIds)                            │
│                                                             │
│ 4. Re-point their secondaries to oldest primary:            │
│    UPDATE contacts                                          │
│    SET linkedId = oldestId                                  │
│    WHERE linkedId IN (otherPrimaryIds)                      │
└─────────────────────────────────────────────────────────────┘
```

#### Step 6: Add New Information (if needed)
```
┌─────────────────────────────────────────────────────────────┐
│ Check if incoming email/phone already exists                │
├─────────────────────────────────────────────────────────────┤
│ IF new email OR new phone:                                  │
│    INSERT INTO contacts (phoneNumber, email, linkedId, linkPrecedence)
│    VALUES (?, ?, oldestPrimary.id, 'secondary')             │
│                                                             │
│ → New data always added as secondary linked to primary      │
└─────────────────────────────────────────────────────────────┘
```

#### Step 7: Build Response
```
┌─────────────────────────────────────────────────────────────┐
│ Construct IdentifyResponse                                  │
├─────────────────────────────────────────────────────────────┤
│ 1. Sort all contacts by createdAt                           │
│ 2. Collect unique emails (ordered by appearance)            │
│ 3. Collect unique phone numbers (ordered by appearance)     │
│ 4. Collect secondaryContactIds                              │
│ 5. Commit transaction                                       │
└─────────────────────────────────────────────────────────────┘
```

### Response Format

```json
{
    "contact": {
        "primaryContactId": 1,
        "emails": ["user@example.com", "new@example.com"],
        "phoneNumbers": ["+1234567890", "+0987654321"],
        "secondaryContactIds": [2, 3, 4]
    }
}
```

---

## Key Design Decisions

### 1. Transaction-Based Processing
- **Why:** Prevents data inconsistency during concurrent requests
- **How:** `FOR UPDATE` row locks + explicit transaction management
- **Rollback:** Automatic on any error

### 2. Primary/Secondary Hierarchy
- **Primary:** Canonical contact record (oldest created)
- **Secondary:** Linked records that share email or phone with primary
- **Merging:** Newer primaries demoted to secondaries, linked to oldest

### 3. Soft Deletes
- `deletedAt` column allows logical deletion
- All queries filter `WHERE deletedAt IS NULL`
- Enables data recovery and audit trails

### 4. Connection Pooling
- MySQL connection pool with 10 concurrent connections
- `waitForConnections: true` - queues requests when pool is full
- Connections released after each operation

### 5. Auto Schema Management
- Server creates table and indexes on startup
- Idempotent operations (safe to run multiple times)
- Fails fast if DB connection is invalid

### 6. Deterministic Primary Selection
- Oldest contact (by `createdAt`) becomes primary
- Tie-breaker: lowest `id`
- Ensures consistent results across concurrent requests

---

## Error Handling

### Validation Errors (400)
```
• "email or phoneNumber is required"
• "email must be a string or null"
• "phoneNumber must be a string or null"
```

### Database Errors (500)
```
• Connection failures → Server exits on startup
• Query errors → Caught and passed to errorHandler
• Transaction failures → Automatic rollback
```

### Global Error Handler
```typescript
{
    "error": "Error message here"
}
```

---

## Startup Sequence

```
1. Load environment variables (.env)
2. Create Express app with middleware
3. Start server initialization:
   a. Get DB connection from pool
   b. Ping database (verify connectivity)
   c. Run ensureSchema() - create table + indexes
   d. Log "Database connection OK"
4. Begin listening on configured port
5. Log "Server listening on port {PORT}"
```

**Failure Mode:** If DB connection fails, server exits with code 1 (no traffic accepted with broken DB).

---

## File Structure

```
src/
├── server.ts           # Entry point, startup logic, DB health check
├── app.ts              # Express app configuration
├── config/
│   └── env.ts          # Environment variable parsing + validation
├── controllers/
│   └── identifyController.ts  # Request handling, response formatting
├── db/
│   └── mysql.ts        # Connection pool, schema management
├── middleware/
│   ├── errorHandler.ts # Global error handling
│   └── validateIdentify.ts   # Input validation
├── routes/
│   └── identifyRoutes.ts     # Route definitions
├── services/
│   └── identifyService.ts    # Core business logic
└── types/
    └── contact.ts      # TypeScript type definitions
```

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Node.js 18+ | JavaScript runtime |
| Language | TypeScript | Type-safe development |
| Framework | Express 5.x | HTTP server & routing |
| Database | MySQL 8+ | Persistent storage |
| DB Driver | mysql2 | Async MySQL client with promises |
| Config | dotenv | Environment variable management |



