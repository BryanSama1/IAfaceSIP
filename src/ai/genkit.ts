
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai'; // Re-enabled

// Check for GOOGLE_API_KEY at startup on the server
if (typeof process !== 'undefined' && process.env && !process.env.GOOGLE_API_KEY) {
  console.error(
    "\n🔴 FATAL ERROR: GOOGLE_API_KEY environment variable is not set." +
    "\n   The Genkit Google AI plugin requires this key to function." +
    "\n   Please ensure it is defined in your .env file (e.g., GOOGLE_API_KEY=your_api_key_here)." +
    "\n   Without it, AI features will likely cause Internal Server Errors.\n"
  );
  // Consider uncommenting the line below to make the server fail hard if the key is missing,
  // which can make this specific issue very obvious during startup.
  // throw new Error("FATAL: GOOGLE_API_KEY is not set.");
}

export const ai = genkit({
  plugins: [
    googleAI() // Re-enabled
  ],
  // model: 'googleai/gemini-2.0-flash', // This line can remain commented if model is specified in flow
});

