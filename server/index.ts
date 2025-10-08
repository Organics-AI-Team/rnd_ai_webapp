import { router } from "./trpc";
import { ordersRouter } from "./routers/orders";
import { usersRouter } from "./routers/users";
import { authRouter } from "./routers/auth";
import { organizationsRouter } from "./routers/organizations";
import { productsRouter } from "./routers/products";
import { userLogsRouter } from "./routers/userLogs";

export const appRouter = router({
  auth: authRouter,
  orders: ordersRouter,
  users: usersRouter,
  organizations: organizationsRouter,
  products: productsRouter,
  userLogs: userLogsRouter,
});

export type AppRouter = typeof appRouter;
