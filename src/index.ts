import "dotenv/config";
import { app } from "./app";
import { syncApplications } from "./catalogue";

const port = process.env.PORT || 3001;

syncApplications()
  .then(() => {
    app.listen(port);
  })
  .catch((err) => {
    console.error("❌ Error al inicializar:", err);
    process.exit(1);
  });
