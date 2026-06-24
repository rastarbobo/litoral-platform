import { z } from 'zod';

export const mediaUpdateSchema = z.object({
  restaurantId: z.string().min(1),
  mediaType: z.enum(['enhancedPhoto', 'demoVideo', 'previewImage']),
  mediaUrl: z.string().url(),
  metadata: z.record(z.unknown()).optional(),
});

// type MediaUpdatePayload = z.infer<typeof mediaUpdateSchema>;
