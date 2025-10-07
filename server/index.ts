import { router } from "./trpc";
import { ordersRouter } from "./routers/orders";
import { usersRouter } from "./routers/users";
import { authRouter } from "./routers/auth";
import { organizationsRouter } from "./routers/organizations";

export const appRouter = router({
  auth: authRouter,
  orders: ordersRouter,
  users: usersRouter,
  organizations: organizationsRouter,
});

export type AppRouter = typeof appRouter;
