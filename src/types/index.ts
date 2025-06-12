
export interface User {
  id: string;
  name: string;
  email: string;
  faceImageUri: string; // Original captured image data URI
  enhancedFaceImageUri: string; // AI enhanced image data URI, used for login
  faceDescriptor?: number[]; // Facial descriptor for recognition
  isAdmin?: boolean;
}
