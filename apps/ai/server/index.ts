import { router } from "./trpc";
import { ordersRouter } from "./routers/orders";
import { usersRouter } from "./routers/users";
import { authRouter } from "./routers/auth";
import { organizationsRouter } from "./routers/organizations";
import { productsRouter } from "./routers/products";
import { userLogsRouter } from "./routers/userLogs";
import { formulasRouter } from "./routers/formulas";
import { feedbackRouter } from "./routers/feedback";
import { conversationRouter } from "./routers/conversations";
import { rawMaterialsConversationRouter } from "./routers/raw-materials-conversations";
import { rawMaterialsFeedbackRouter } from "./routers/raw-materials-feedback";
import { ragRouter } from "./routers/rag";
import { stockRouter } from "./routers/stock";
import { calculationsRouter } from "./routers/calculations";

export const appRouter = router({
  auth: authRouter,
  orders: ordersRouter,
  users: usersRouter,
  organizations: organizationsRouter,
  products: productsRouter,
  userLogs: userLogsRouter,
  formulas: formulasRouter,
  feedback: feedbackRouter,
  conversations: conversationRouter,
  rawMaterialsConversations: rawMaterialsConversationRouter,
  rawMaterialsFeedback: rawMaterialsFeedbackRouter,
  rag: ragRouter,
  stock: stockRouter,
  calculations: calculationsRouter,
});

export type AppRouter = typeof appRouter;
