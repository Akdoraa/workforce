import { Router, type IRouter } from "express";
import healthRouter from "./health";
import builderRouter from "./builder";
import agentsRouter from "./agents";
import stripeRouter from "./stripe";

const router: IRouter = Router();

router.use(healthRouter);
router.use(builderRouter);
router.use(agentsRouter);
router.use(stripeRouter);

export default router;
