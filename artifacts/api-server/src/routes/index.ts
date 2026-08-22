import { Router, type IRouter } from "express";
import attendanceRouter from "./attendance";
import adminEmployeesRouter from "./adminEmployees";
import authRouter from "./auth";
import healthRouter from "./health";
import mediaRouter from "./media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(mediaRouter);
router.use(adminEmployeesRouter);
router.use(attendanceRouter);

export default router;
