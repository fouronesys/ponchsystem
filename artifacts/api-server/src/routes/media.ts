import { attendanceEventsTable, db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { getImage, mimeFromPath } from "../lib/imageStorage";
import { requireAuthenticated, type AuthenticatedRequest } from "../middlewares/attendanceAuth";

const router: IRouter = Router();

router.get(
  "/media/:category/:filename",
  requireAuthenticated,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const category = req.params.category;
    const filename = req.params.filename;
    const imageRef = `${category}/${filename}`;

    if (category !== "profiles" && category !== "selfies") {
      res.status(404).end();
      return;
    }

    if (req.employee!.role !== "admin") {
      if (category === "profiles") {
        if (req.employee!.profilePhotoPath !== imageRef) {
          res.status(403).json({ error: "No tienes permiso para ver esta imagen." });
          return;
        }
      } else {
        const [event] = await db
          .select({ employeeId: attendanceEventsTable.employeeId })
          .from(attendanceEventsTable)
          .where(eq(attendanceEventsTable.selfiePath, imageRef))
          .limit(1);
        if (!event || event.employeeId !== req.employee!.id) {
          res.status(403).json({ error: "No tienes permiso para ver esta imagen." });
          return;
        }
      }
    }

    try {
      const image = await getImage(imageRef);
      res.set("Cache-Control", "private, max-age=300");
      res.type(mimeFromPath(imageRef)).send(image);
    } catch {
      res.status(404).json({ error: "Imagen no encontrada." });
    }
  },
);

export default router;