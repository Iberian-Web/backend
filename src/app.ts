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

// En producción, ALLOWED_ORIGINS debe estar configurada: con credentials:true,
// "sin origins en la lista" no puede significar "aceptar cualquiera". Fuera
// de producción se mantiene el comportamiento permisivo de siempre.
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && allowedOrigins.length === 0) {
  console.warn(
    "⚠️  ALLOWED_ORIGINS no está configurada en producción: se rechazará cualquier origen con credenciales.",
  );
}

export const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // Peticiones sin Origin (curl, health checks, server-to-server) se permiten.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Fuera de producción, sin ALLOWED_ORIGINS configurada, se permite
      // cualquier origen (comportamiento de desarrollo de siempre).
      if (!isProduction && allowedOrigins.length === 0) {
        callback(null, true);
        return;
      }
      callback(new Error("No permitido por CORS"));
    },
    credentials: true,
  }),
);
// Un backup completo incluye todos los PDFs en base64: necesita un límite de
// body muy por encima del resto de rutas, así que se aplica solo aquí, antes
// del express.json() general de más abajo.
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
