import { router } from "./trpc";
import { ordersRouter } from "./routers/orders";
import { usersRouter } from "./routers/users";

export const appRouter = router({
  orders: ordersRouter,
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
