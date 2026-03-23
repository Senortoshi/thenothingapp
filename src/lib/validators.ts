import { z } from "zod";
import { MAX_COMMENT_LENGTH, MAX_DISPLAY_NAME_LENGTH } from "./constants";

// POST /api/comments — request body
export const postCommentSchema = z.object({
  commentText: z
    .string()
    .trim()
    .min(1, "Comment cannot be empty")
    .max(MAX_COMMENT_LENGTH, `Comment must be ${MAX_COMMENT_LENGTH} chars or fewer`),
  displayName: z
    .string()
    .trim()
    .max(MAX_DISPLAY_NAME_LENGTH, `Name must be ${MAX_DISPLAY_NAME_LENGTH} chars or fewer`)
    .optional()
    .default("Anonymous"),
  parentTxid: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "Invalid parent txid")
    .optional(),
  tipAddress: z
    .string()
    .trim()
    .regex(/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/, "Invalid BSV address")
    .optional(),
});

export type PostCommentInput = z.infer<typeof postCommentSchema>;

// GET /api/comments — query string cursor
export const getCommentsSchema = z.object({
  cursorOffset: z.coerce.number().int().min(0).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(20),
});

export type GetCommentsInput = z.infer<typeof getCommentsSchema>;
