import { router } from "./trpc";
import { ordersRouter } from "./routers/orders";
import { usersRouter } from "./routers/users";
import { authRouter } from "./routers/auth";
import { organizationsRouter } from "./routers/organizations";
import { productsRouter } from "./routers/products";
import { userLogsRouter } from "./routers/userLogs";
import { formulasRouter } from "./routers/formulas";
import { vectorIndexRouter } from "./routers/vector-index";
import { stockRouter } from "./routers/stock";
import { calculationsRouter } from "./routers/calculations";
import { formulaCommentsRouter } from "./routers/formula-comments";
import { formulaVersionLogsRouter } from "./routers/formula-version-logs";
import { chatThreadsRouter } from "./routers/chat-threads";

export const appRouter = router({
  auth: authRouter,
  orders: ordersRouter,
  users: usersRouter,
  organizations: organizationsRouter,
  products: productsRouter,
  userLogs: userLogsRouter,
  formulas: formulasRouter,
  vectorIndex: vectorIndexRouter,
  stock: stockRouter,
  calculations: calculationsRouter,
  formulaComments: formulaCommentsRouter,
  formulaVersionLogs: formulaVersionLogsRouter,
  chatThreads: chatThreadsRouter,
});

export type AppRouter = typeof appRouter;
