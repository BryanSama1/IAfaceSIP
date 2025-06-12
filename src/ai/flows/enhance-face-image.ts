// This is an AI-powered face enhancer flow designed to optimize user profile pictures for face recognition.
// It takes a photo of a face as input and returns an enhanced version that meets specific criteria for recognition.
// The flow leverages facial landmark detection, cropping, and pose adjustments to standardize face images.

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EnhanceFaceImageInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of a face, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type EnhanceFaceImageInput = z.infer<typeof EnhanceFaceImageInputSchema>;

const EnhanceFaceImageOutputSchema = z.object({
  enhancedPhotoDataUri: z
    .string()
    .describe(
      'The enhanced photo of the face, as a data URI with MIME type and Base64 encoding.'
    ),
});
export type EnhanceFaceImageOutput = z.infer<typeof EnhanceFaceImageOutputSchema>;

export async function enhanceFaceImage(input: EnhanceFaceImageInput): Promise<EnhanceFaceImageOutput> {
  return enhanceFaceImageFlow(input);
}

const enhanceFaceImagePrompt = ai.definePrompt({
  name: 'enhanceFaceImagePrompt',
  input: {schema: EnhanceFaceImageInputSchema},
  output: {schema: EnhanceFaceImageOutputSchema},
  prompt: [
    {media: {url: '{{{photoDataUri}}}'}},
    {
      text:
        'Enhance this image to improve its suitability for facial recognition. Ensure the face is clear, well-lit, and centered. Adjust the pose to be as frontal as possible. Return only the enhanced image as a data URI.'
    },
  ],
  config: {
    responseModalities: ['TEXT', 'IMAGE'],
  },
});

const enhanceFaceImageFlow = ai.defineFlow(
  {
    name: 'enhanceFaceImageFlow',
    inputSchema: EnhanceFaceImageInputSchema,
    outputSchema: EnhanceFaceImageOutputSchema,
  },
  async input => {
    const {media} = await ai.generate({
      model: 'googleai/gemini-2.0-flash-exp',
      prompt: [
        {media: {url: input.photoDataUri}},
        {
          text:
            'Enhance this image to improve its suitability for facial recognition. Ensure the face is clear, well-lit, and centered. Adjust the pose to be as frontal as possible. Return only the enhanced image as a data URI.'
        },
      ],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    return {enhancedPhotoDataUri: media.url!};
  }
);
