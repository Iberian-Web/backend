import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { errorHandler } from "./lib/errors";
import { publicRouter } from "./routes/public";
import { adminRouter } from "./routes/admin";
import { documentsRouter } from "./routes/documents";
import { customerRouter } from "./routes/customer";
import { backupRouter } from "./routes/backup";

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // Peticiones sin Origin (curl, health checks, server-to-server) se permiten.
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(new Error("No permitido por CORS"));
    },
    credentials: true,
  }),
);
// Un backup completo puede incluir todos los PDFs de todos los clientes en
// base64: necesita un límite de tamaño de body muy por encima del resto de
// endpoints, así que se aplica solo a esta ruta, antes del express.json()
// general (más abajo) que usa el límite por defecto.
app.use("/api/backup/import", express.json({ limit: "500mb" }));
app.use(express.json());
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.json({ message: "CRM API running" });
});

app.use("/api", publicRouter);
app.use("/api", adminRouter);
app.use("/api", documentsRouter);
app.use("/api", customerRouter);
app.use("/api", backupRouter);

app.use(errorHandler);
