import express from "express";
import identifyRoutes from "./routes/identifyRoutes";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

app.use(express.json());
app.use(identifyRoutes);
app.use(errorHandler);

export default app;
