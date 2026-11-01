import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Use at most 72 characters.")
  .regex(/[a-z]/, "Include a lower-case letter.")
  .regex(/[A-Z]/, "Include an upper-case letter.")
  .regex(/[0-9]/, "Include a number.");

export const PASSWORD_HINT = "At least 10 characters, with upper- and lower-case letters and a number.";
