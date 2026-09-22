import { Router, type IRouter } from "express";
import healthRouter from "./health";
import monitoringRouter from "./monitoring";

const router: IRouter = Router();

router.use(healthRouter);
router.use(monitoringRouter);

export default router;
