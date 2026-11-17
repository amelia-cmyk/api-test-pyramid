import { createDatabase } from './db/database.js';
import { createApp } from './http/app.js';

// DATA_DIR keeps data on disk between restarts; without it the database lives in memory.
const db = await createDatabase(process.env.DATA_DIR);
const port = Number(process.env.PORT ?? 3000);

createApp({ db }).listen(port, () => {
  console.log(`Library API listening on http://localhost:${port}`);
});
