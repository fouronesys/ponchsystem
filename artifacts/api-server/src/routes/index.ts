import { Router, type IRouter } from "express";
import attendanceRouter from "./attendance";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(attendanceRouter);

export default router;
