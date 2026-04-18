import { Router, type IRouter } from "express";
import healthRouter from "./health";
import builderRouter from "./builder";
import agentsRouter from "./agents";

const router: IRouter = Router();

router.use(healthRouter);
router.use(builderRouter);
router.use(agentsRouter);

export default router;
