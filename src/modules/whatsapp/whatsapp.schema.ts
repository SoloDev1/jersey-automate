import { z } from 'zod';

export const onboardSchema = z.object({
  code: z.string().optional(),
  accessToken: z.string().optional(),
  wabaId: z.string().optional(),
  phoneNumberId: z.string().optional()
}).refine((data) => Boolean(data.code || data.accessToken), {
  message: 'Either authorization code or access token must be provided'
});
