import { Router, type IRouter } from "express";
import healthRouter from "./health";
import builderRouter from "./builder";
import agentsRouter from "./agents";
import stripeRouter from "./stripe";
import slackRouter from "./slack";

const router: IRouter = Router();

router.use(healthRouter);
router.use(builderRouter);
router.use(agentsRouter);
router.use(stripeRouter);
router.use(slackRouter);

export default router;
