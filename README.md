# Firebase Studio - FaceLog App

This is a NextJS starter app in Firebase Studio that demonstrates user registration and login using face capture and AI-enhanced images.

To get started, take a look at `src/app/page.tsx`.

## Prerequisites

Before running the application, you need to set up your environment, particularly for the Generative AI features.

1.  **Google AI API Key**:
    *   This application uses Genkit with Google AI (Gemini models) to enhance face images during user signup.
    *   You need a Google AI API key. You can obtain one from [Google AI Studio](https://aistudio.google.com/app/apikey).
    *   Create a file named `.env` in the root of the project (you can copy `.env.example` to `.env`).
    *   Add your API key to the `.env` file:
        ```
        GOOGLE_API_KEY="YOUR_GOOGLE_AI_API_KEY_HERE"
        ```

## Running the Application

1.  **Install dependencies**:
    If you haven't already, or if `package.json` changed, dependencies are usually installed automatically by Firebase Studio. If running locally, you might use:
    ```bash
    npm install
    # or
    yarn install
    ```

2.  **Run the development server**:
    ```bash
    npm run dev
    # or
    yarn dev
    ```
    This will start the Next.js application, typically on `http://localhost:9002`.

3.  **Run the Genkit development server (optional but recommended for AI flow development)**:
    In a separate terminal, run:
    ```bash
    npm run genkit:dev
    # or to watch for changes:
    npm run genkit:watch
    ```
    This starts the Genkit developer UI, usually on `http://localhost:4000`, where you can inspect and test your AI flows.

## How it Works

*   **Signup**: Users provide their name, email, and capture their face. The captured face image is sent to an AI flow (`enhanceFaceImage`) which attempts to create an optimized version for recognition. Both original and enhanced images are associated with the user.
*   **Login**: Users provide their email and capture their face again. The system checks if the email is registered. For this prototype, "face detection" for login is simulated by confirming a face was successfully captured, rather than performing a full biometric comparison.
*   **Admin Panel**: The first user to sign up becomes an admin. Admins can view a list of users and update their login face images from the `/admin/users` page.

## Key Technologies

*   Next.js (App Router)
*   React
*   TypeScript
*   Tailwind CSS
*   ShadCN UI Components
*   Genkit (for AI flows with Google Gemini)
*   Lucide React (for icons)
