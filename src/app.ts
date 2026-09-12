import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { errorHandler } from "./lib/errors";
import { publicRouter } from "./routes/public";
import { adminRouter } from "./routes/admin";
import { customerRouter } from "./routes/customer";

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
app.use(express.json());
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.json({ message: "CRM API running" });
});

app.use("/api", publicRouter);
app.use("/api", adminRouter);
app.use("/api", customerRouter);

app.use(errorHandler);
