
'use server';
/**
 * @fileOverview AI-powered face enhancement flow.
 * This flow takes a face photo as a data URI and uses a generative AI model
 * to enhance it for better facial recognition suitability.
 *
 * Exports:
 * - enhanceFaceImage: The primary function to call for face enhancement.
 * - EnhanceFaceImageInput: The Zod schema and TypeScript type for the input.
 * - EnhanceFaceImageOutput: The Zod schema and TypeScript type for the output.
 */

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

// This is the exported function called by the client-side AuthContext
export async function enhanceFaceImage(input: EnhanceFaceImageInput): Promise<EnhanceFaceImageOutput> {
  console.log("[enhanceFaceImage API Wrapper] Flow called with input URI starting with:", input.photoDataUri.substring(0, 100) + "...");
  try {
    // Check if enhanceFaceImageFlow is a function before calling
    if (typeof enhanceFaceImageFlow !== 'function') {
      console.error("[enhanceFaceImage API Wrapper] CRITICAL: enhanceFaceImageFlow is not defined or not a function. This likely means its definition failed.");
      throw new Error("AI flow (enhanceFaceImageFlow) is not available. Check server logs for definition errors.");
    }
    const result = await enhanceFaceImageFlow(input);
    if (!result || !result.enhancedPhotoDataUri) {
      console.error("[enhanceFaceImage API Wrapper] Flow returned invalid result:", result);
      throw new Error("AI flow failed to produce an enhanced image URI.");
    }
    console.log("[enhanceFaceImage API Wrapper] Flow succeeded, returning URI starting with:", result.enhancedPhotoDataUri.substring(0,100) + "...");
    return result;
  } catch (error) {
    console.error("[enhanceFaceImage API Wrapper] Error executing enhanceFaceImageFlow. Full error object:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Attempt to get more details from the error object if it's structured
    let fullErrorDetails = errorMessage;
    if (error instanceof Error && (error as any).cause) {
      fullErrorDetails += ` | Cause: ${JSON.stringify((error as any).cause)}`;
    }
    if ((error as any).details) {
       fullErrorDetails += ` | Details: ${JSON.stringify((error as any).details)}`;
    }
    console.error(`[enhanceFaceImage API Wrapper] Processed error message: ${fullErrorDetails}`);
    throw new Error(`Failed to enhance face image via API wrapper: ${fullErrorDetails}`);
  }
}

let _enhanceFaceImagePrompt_UNUSED: any;
try {
  _enhanceFaceImagePrompt_UNUSED = ai.definePrompt({
    name: 'enhanceFaceImagePromptUnused',
    // model: 'googleai/gemini-2.0-flash-exp', // Required if this prompt object were to be used for image generation
    input: {schema: EnhanceFaceImageInputSchema},
    output: {schema: EnhanceFaceImageOutputSchema},
    prompt: [
      {media: {url: '{{{photoDataUri}}}'}}, // Note: uses Handlebars syntax for prompt objects
      {
        text:
          'Enhance this image to improve its suitability for facial recognition. Ensure the face is clear, well-lit, and centered. Adjust the pose to be as frontal as possible. Return only the enhanced image as a data URI.'
      },
    ],
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });
} catch (e) {
  console.error("[enhanceFaceImage Flow Definition] FATAL ERROR defining _enhanceFaceImagePrompt_UNUSED:", e);
  // We don't throw here as it's unused, but it's a critical log
}


let enhanceFaceImageFlow: any; // Define with 'any' initially
try {
  enhanceFaceImageFlow = ai.defineFlow(
    {
      name: 'enhanceFaceImageFlow',
      inputSchema: EnhanceFaceImageInputSchema,
      outputSchema: EnhanceFaceImageOutputSchema,
    },
    async (input: EnhanceFaceImageInput) : Promise<EnhanceFaceImageOutput> => {
      console.log("[enhanceFaceImageFlow Genkit Flow] Starting. Input URI begins with:", input.photoDataUri.substring(0, 100) + `... (Total length: ${input.photoDataUri.length})`);
      try {
        const {media, output} = await ai.generate({
          model: 'googleai/gemini-2.0-flash-exp', // Correct model for image generation
          prompt: [
            {media: {url: input.photoDataUri}}, // Direct use of input data URI
            {
              text:
                'Enhance this image to improve its suitability for facial recognition. Ensure the face is clear, well-lit, and centered. Adjust the pose to be as frontal as possible. Return only the enhanced image as a data URI.'
            },
          ],
          config: {
            responseModalities: ['TEXT', 'IMAGE'], // Crucial for image generation
          },
        });

        const mediaLogSnippet = media ? JSON.stringify(media).substring(0, 300) + (JSON.stringify(media).length > 300 ? "..." : "") : "null";
        console.log("[enhanceFaceImageFlow Genkit Flow] ai.generate call completed. Media object (snippet):", mediaLogSnippet);
        console.log("[enhanceFaceImageFlow Genkit Flow] ai.generate call completed. Text output object:", JSON.stringify(output, null, 2));

        if (media && media.url) {
          console.log("[enhanceFaceImageFlow Genkit Flow] Enhanced image media URL obtained, starts with:", media.url.substring(0,100)+"...");
          return {enhancedPhotoDataUri: media.url};
        } else {
          console.error("[enhanceFaceImageFlow Genkit Flow] ai.generate did not return a media.url. Media:", mediaLogSnippet, "Output:", output);
          throw new Error("AI image generation failed: No media URL was returned from the model.");
        }
      } catch (e: any) {
        let detailedErrorMessage = "Unknown error during AI generation.";
        let errorStack = "";
        let errorName = "UnknownError";
        
        const errorProperties: Record<string, any> = {};
        if (typeof e === 'object' && e !== null) {
          Object.getOwnPropertyNames(e).forEach(key => {
            errorProperties[key] = e[key];
          });
        }

        if (e instanceof Error) {
          detailedErrorMessage = e.message;
          errorStack = e.stack || "";
          errorName = e.name;
        } else {
          detailedErrorMessage = String(e);
        }

        console.error(`[enhanceFaceImageFlow Genkit Flow] BEGIN DETAILED ERROR LOG ==============================`);
        console.error(`  Error Type: ${errorName}`);
        console.error(`  Error Message: ${detailedErrorMessage}`);
        console.error(`  Error Properties: ${JSON.stringify(errorProperties, null, 2)}`);
        console.error(`  Full Error Object (raw):`, e); // Logs the original error object
        console.error(`  Stack Trace: ${errorStack}`);
        console.error(`[enhanceFaceImageFlow Genkit Flow] END DETAILED ERROR LOG ================================`);
        
        if (detailedErrorMessage.toLowerCase().includes("api_key") || detailedErrorMessage.toLowerCase().includes("quota") || detailedErrorMessage.toLowerCase().includes("permission") || (e && (e as any).status === 403)) {
           console.error("[enhanceFaceImageFlow Genkit Flow] CRITICAL HINT: A potential API key, permission, or quota issue was detected. Please verify your GOOGLE_API_KEY environment variable and check your Google Cloud project quotas and API enablement for 'Generative Language API' or similar.");
           throw new Error(`AI generation failed: API key, permission, or quota issue. Original message: ${detailedErrorMessage}`);
        }
        // For other errors, rethrow a generic message but include original if possible
        throw new Error(`AI generation failed within Genkit flow. Original: ${detailedErrorMessage}`);
      }
    }
  );
} catch (e) {
  console.error("[enhanceFaceImage Flow Definition] FATAL ERROR defining enhanceFaceImageFlow:", e);
  // If flow definition fails, enhanceFaceImageFlow will remain undefined or be whatever was partially assigned.
  // The exported enhanceFaceImage function has a check for this.
  // It's crucial to check server logs for this FATAL ERROR message.
}
