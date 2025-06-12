
"use client";

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, CheckCircle2, AlertTriangle, Video, UploadCloud, UserCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import * as faceapi from 'face-api.js';

interface FaceCaptureProps {
  onFaceCaptured: (dataUrl: string, descriptor: number[] | null) => void;
  mainCaptureButtonTextIfLive?: string; // Text for the button after liveness check passes
  context: 'login' | 'signup' | 'admin_update'; // admin_update might not use video liveness for now
}

type LivenessStep = 'initial' | 'awaiting_models' | 'awaiting_camera_for_video' | 'ready_to_record' | 'recording_video' | 'verifying_video' | 'human_verified' | 'human_verification_failed' | 'final_capture_ready' ;

const VIDEO_RECORDING_DURATION_MS = 5000; // 5 seconds

const FaceCapture: React.FC<FaceCaptureProps> = ({
  onFaceCaptured,
  mainCaptureButtonTextIfLive = "Capturar Rostro",
  context,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null); // For final still image
  const detectionCanvasRef = useRef<HTMLCanvasElement>(null); // For drawing detections on final capture stage

  const [livenessStep, setLivenessStep] = useState<LivenessStep>('initial');
  const [statusMessage, setStatusMessage] = useState<string>("Inicializando...");

  const [currentStream, setCurrentStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isVerifyingWithAPI, setIsVerifyingWithAPI] = useState(false);
  const [isProcessingFinalCapture, setIsProcessingFinalCapture] = useState(false);

  const modelsLoadedRef = useRef(false); // For face-api.js models needed for descriptor

  const { toast } = useToast();
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null); // For final face detection (still image)

  const loadModels = useCallback(async () => {
    if (modelsLoadedRef.current) return;
    setLivenessStep('awaiting_models');
    setStatusMessage("Cargando modelos de reconocimiento facial...");
    const MODEL_URL = '/models';
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
      modelsLoadedRef.current = true;
      setStatusMessage("Modelos cargados. Listo para iniciar verificación.");
      setLivenessStep('initial'); // Go back to initial to show verify button
    } catch (e) {
      const errorMsg = `Error cargando modelos: ${e instanceof Error ? e.message : String(e)}.`;
      setError(errorMsg);
      setStatusMessage(errorMsg);
      setLivenessStep('human_verification_failed'); // A general failure state
      toast({ title: "Error en Modelos Faciales", description: errorMsg, variant: "destructive", duration: 7000 });
    }
  }, [toast]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const stopCamera = useCallback((calledFrom?: string) => {
    console.log(`FaceCapture: stopCamera llamado desde: ${calledFrom || 'desconocido'}`);
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    detectionIntervalRef.current = null;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }
    setCurrentStream(null);
    setIsCameraActive(false);
    if (videoRef.current) videoRef.current.srcObject = null;

  }, [currentStream]);

  const startCamera = useCallback(async (purpose: 'video_liveness' | 'final_capture') => {
    if (currentStream || isStartingCamera) return;
    
    setError(null);
    setIsStartingCamera(true);
    setStatusMessage("Iniciando cámara...");
    if (purpose === 'video_liveness') setLivenessStep('awaiting_camera_for_video');

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      setCurrentStream(mediaStream);
      // isCameraActive will be set to true in useEffect for video.onloadedmetadata
    } catch (err) {
      let message = err instanceof Error ? `${err.name}: ${err.message}` : "Error desconocido de cámara.";
      if (err instanceof Error && err.name === "NotAllowedError") message = "Permiso de cámara denegado.";
      setError(message);
      setStatusMessage(message);
      setLivenessStep('human_verification_failed');
      toast({ title: "Error de Cámara", description: message, variant: "destructive" });
    } finally {
      setIsStartingCamera(false);
    }
  }, [isStartingCamera, currentStream, toast]);


  useEffect(() => {
    const videoNode = videoRef.current;
    if (videoNode && currentStream) {
        if (!videoNode.srcObject || videoNode.srcObject !== currentStream) {
             videoNode.srcObject = currentStream;
        }
        const handleCanPlay = () => {
            videoNode.play()
              .then(() => {
                setIsCameraActive(true);
                setStatusMessage("Cámara activa.");
                if (livenessStep === 'awaiting_camera_for_video') {
                  setLivenessStep('ready_to_record');
                  setStatusMessage("Cámara lista. Preparado para grabar video de verificación.");
                } else if (livenessStep === 'human_verified') {
                  setLivenessStep('final_capture_ready');
                  setStatusMessage("Verificación humana exitosa. Listo para captura final.");
                }
              })
              .catch(playError => {
                setError(`Error reproducción: ${playError instanceof Error ? playError.message : String(playError)}`);
                stopCamera('play_error_effect');
                setLivenessStep('human_verification_failed');
              });
        };
        videoNode.addEventListener('canplay', handleCanPlay);
        if (videoNode.readyState >= videoNode.HAVE_ENOUGH_DATA) { // If already ready
            handleCanPlay();
        }
        return () => {
            videoNode.removeEventListener('canplay', handleCanPlay);
        }
    } else if (videoNode && !currentStream) {
        videoNode.srcObject = null;
        setIsCameraActive(false);
    }
  }, [currentStream, livenessStep, stopCamera]);


  const handleStartHumanVerification = async () => {
    if (!modelsLoadedRef.current) {
      toast({ title: "Modelos no cargados", description: "Los modelos de reconocimiento facial aún se están cargando.", variant: "default" });
      return;
    }
    recordedChunksRef.current = []; // Clear previous recording
    await startCamera('video_liveness');
    // useEffect for currentStream will trigger 'ready_to_record' and then actual recording
  };

  useEffect(() => {
    // This effect starts recording once camera is ready for video liveness
    if (livenessStep === 'ready_to_record' && currentStream && videoRef.current && !isRecording) {
      setIsRecording(true);
      setStatusMessage("Grabando video de verificación (5s)...");
      setLivenessStep('recording_video');

      try {
        // Try common MIME types, browser will pick one it supports
        const options = { mimeType: 'video/webm;codecs=vp8' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.warn(`${options.mimeType} no es soportado, intentando con default.`);
            // @ts-ignore
            delete options.mimeType;
        }
        
        mediaRecorderRef.current = new MediaRecorder(currentStream, options);
        
        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };
        
        mediaRecorderRef.current.onstop = async () => {
          setIsRecording(false);
          setStatusMessage("Video grabado. Enviando para verificación...");
          setLivenessStep('verifying_video');
          setIsVerifyingWithAPI(true);

          const videoBlob = new Blob(recordedChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'video/webm' });
          recordedChunksRef.current = []; // Clear for next potential recording

          console.log("Video Blob size:", videoBlob.size, "type:", videoBlob.type);
          if (videoBlob.size > 6 * 1024 * 1024) { // Check size
            toast({ title: "Video Demasiado Grande", description: `El video grabado excede los 6MB (${(videoBlob.size / (1024*1024)).toFixed(2)}MB). Intenta de nuevo.`, variant: "destructive" });
            setLivenessStep('human_verification_failed');
            setIsVerifyingWithAPI(false);
            stopCamera('video_too_large');
            return;
          }

          const formData = new FormData();
          formData.append("prompt", "Verifica si la persona en el video es real y viva.");
          formData.append("video_file", videoBlob, "liveness_video.webm"); // Filename helps API

          try {
            const response = await fetch("https://facesip-ia-127465468754.us-central1.run.app", {
              method: "POST",
              body: formData,
            });

            if (!response.ok) {
              throw new Error(`Error de API: ${response.status} ${response.statusText}`);
            }

            const outerResponse = await response.json();
            // Expecting double stringified JSON based on user's example
            let isLivePerson = false;
            try {
                const innerJsonResponseString = outerResponse.response;
                const innerJsonResponse = JSON.parse(innerJsonResponseString);
                const finalDataString = innerJsonResponse.response; // This seems to be the actual JSON string
                const finalData = JSON.parse(finalDataString);
                isLivePerson = finalData.isLivePerson === true;
            } catch (parseError) {
                console.error("Error parsing API response:", parseError, "Outer response:", outerResponse);
                throw new Error("Respuesta de API malformada.");
            }
            

            if (isLivePerson) {
              toast({ title: "Verificación Humana Exitosa", description: "Persona real detectada.", duration: 3000 });
              setLivenessStep('human_verified');
              setStatusMessage("¡Verificado! Ahora puedes capturar tu rostro.");
              // Camera remains active for final capture
              await startCamera('final_capture'); // Ensure camera is set for final capture if it was stopped
            } else {
              toast({ title: "Verificación Humana Fallida", description: "No se pudo confirmar que eres una persona real. Intenta de nuevo.", variant: "destructive", duration: 5000 });
              setLivenessStep('human_verification_failed');
              setStatusMessage("Verificación fallida. Asegura buena iluminación y mira a la cámara.");
              stopCamera('liveness_api_failed');
            }
          } catch (apiError) {
            console.error("Error en API de liveness:", apiError);
            toast({ title: "Error de Verificación", description: `No se pudo completar la verificación: ${apiError instanceof Error ? apiError.message : String(apiError)}`, variant: "destructive" });
            setLivenessStep('human_verification_failed');
            setStatusMessage("Error de comunicación con el servicio de verificación.");
            stopCamera('liveness_api_exception');
          } finally {
            setIsVerifyingWithAPI(false);
          }
        };

        mediaRecorderRef.current.start();
        setTimeout(() => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
        }, VIDEO_RECORDING_DURATION_MS);

      } catch (mediaRecorderError) {
        console.error("Error MediaRecorder:", mediaRecorderError);
        toast({ title: "Error de Grabación", description: "No se pudo iniciar la grabación de video.", variant: "destructive" });
        setIsRecording(false);
        setLivenessStep('human_verification_failed');
        setStatusMessage("Error al iniciar la grabación.");
        stopCamera('media_recorder_init_error');
      }
    }
  }, [livenessStep, currentStream, isRecording, stopCamera, toast, startCamera]);

  // Effect for face detection during the *final capture* stage
  useEffect(() => {
    if (livenessStep === 'final_capture_ready' && isCameraActive && modelsLoadedRef.current && !detectionIntervalRef.current && videoRef.current) {
        const video = videoRef.current;
        const canvas = detectionCanvasRef.current;
        if (!canvas) return;

        detectionIntervalRef.current = setInterval(async () => {
            if (video.paused || video.ended || video.readyState < video.HAVE_ENOUGH_DATA) return;
            
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            if (displaySize.width === 0 || displaySize.height === 0) return;
            faceapi.matchDimensions(canvas, displaySize);

            const detectionsResults = await faceapi
              .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
              .withFaceLandmarks();
            
            const context = canvas.getContext('2d');
            if (!context) return;
            context.clearRect(0, 0, canvas.width, canvas.height);

            if (detectionsResults) {
                const resizedDetections = faceapi.resizeResults(detectionsResults, displaySize);
                faceapi.draw.drawDetections(canvas, resizedDetections);
                // faceapi.draw.drawFaceLandmarks(canvas, resizedDetections); // Optional: draw landmarks for final capture
                setStatusMessage("Rostro detectado. ¡Sonríe!"); // Update status for final capture
            } else {
                setStatusMessage("Buscando rostro para captura final...");
            }
        }, 250);
    } else if ((livenessStep !== 'final_capture_ready' || !isCameraActive) && detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
        if(detectionCanvasRef.current) {
            const context = detectionCanvasRef.current.getContext('2d');
            context?.clearRect(0, 0, detectionCanvasRef.current.width, detectionCanvasRef.current.height);
        }
    }
    return () => {
        if (detectionIntervalRef.current) {
            clearInterval(detectionIntervalRef.current);
            detectionIntervalRef.current = null;
        }
    };
  }, [livenessStep, isCameraActive]);


  const handleFinalCapture = async () => {
    if (!videoRef.current || !captureCanvasRef.current || !currentStream || !isCameraActive || livenessStep !== 'final_capture_ready') {
      toast({ title: "Error de Captura", description: "La cámara no está lista o no se ha verificado la identidad.", variant: "destructive" });
      return;
    }
    setIsProcessingFinalCapture(true);
    setStatusMessage("Procesando imagen final...");

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (context) context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    
    const dataUrl = canvas.toDataURL('image/png');
    let descriptor: number[] | null = null;

    try {
      const detectionResult = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
        .withFaceLandmarks().withFaceDescriptor();
      if (detectionResult) {
        descriptor = Array.from(detectionResult.descriptor);
        toast({ title: "Éxito", description: "Descriptor facial para imagen final calculado." });
      } else {
        toast({ title: "Advertencia Descriptor", description: "No se pudo calcular el descriptor facial para la imagen final. Intenta de nuevo.", duration: 7000 });
      }
    } catch (descError) {
      toast({ title: "Error Descriptor", description: `Falló cálculo del descriptor final: ${descError instanceof Error ? descError.message : String(descError)}`, variant: "destructive" });
    }
    
    onFaceCaptured(dataUrl, descriptor);
    stopCamera('final_capture_complete');
    setIsProcessingFinalCapture(false);
    setLivenessStep('initial'); // Reset for next potential use
    setStatusMessage("Proceso completado.");
  };

  const handleRetry = () => {
    stopCamera('retry_button');
    setError(null);
    setLivenessStep('initial');
    setIsRecording(false);
    setIsVerifyingWithAPI(false);
    setIsProcessingFinalCapture(false);
    setStatusMessage("Listo para nuevo intento de verificación.");
    loadModels(); // Ensure models are re-checked or re-loaded if failed
  };

  useEffect(() => {
    return () => {
      stopCamera('component_unmount');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const imageSize = 320; // For preview display consistency
  const previewStyle = { width: `${imageSize}px`, height: `${imageSize * 0.75}px` }; // 4:3 aspect ratio

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md">
      <div
        className="relative rounded-lg overflow-hidden border-2 border-dashed border-primary bg-muted"
        style={previewStyle}
      >
        <video
          key={currentStream ? currentStream.id : 'video-placeholder'}
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn("object-cover w-full h-full transform scaleX-[-1]", { 'hidden': !isCameraActive })}
          style={previewStyle}
        />
        <canvas // For final capture stage face detection drawing
            ref={detectionCanvasRef}
            className={cn("absolute top-0 left-0 object-cover transform scaleX-[-1]", { 'hidden': !isCameraActive || livenessStep !== 'final_capture_ready' })}
            style={previewStyle}
        />

        {!isCameraActive && (livenessStep === 'initial' || livenessStep === 'awaiting_models' || livenessStep === 'awaiting_camera_for_video') && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/80 p-4 text-center">
                {(isStartingCamera || livenessStep === 'awaiting_models') && <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />}
                <p className="text-sm text-foreground">{statusMessage}</p>
                {error && <p className="text-sm text-destructive mt-1">{error}</p>}
             </div>
        )}
        {isRecording && (
            <div className="absolute top-2 right-2 flex items-center gap-2 bg-red-500 text-white px-2 py-1 rounded-md text-xs">
                <Video className="h-3 w-3" /> GRABANDO
            </div>
        )}
      </div>
      <canvas ref={captureCanvasRef} className="hidden"></canvas>

      {statusMessage && (
        <div className={cn("p-2 rounded-md text-center text-sm w-full",
            {'bg-green-100 text-green-700': livenessStep === 'human_verified' || livenessStep === 'final_capture_ready'},
            {'bg-red-100 text-red-700': livenessStep === 'human_verification_failed' || error},
            {'bg-blue-100 text-blue-700': livenessStep !== 'human_verified' && livenessStep !== 'human_verification_failed' && !error && livenessStep !== 'final_capture_ready'}
        )}>
          {statusMessage}
        </div>
      )}

      {/* Button to Start Human Verification Video Recording */}
      {(livenessStep === 'initial' || livenessStep === 'ready_to_record') && !isCameraActive && !isRecording && !isVerifyingWithAPI && (
        <Button onClick={handleStartHumanVerification} className="w-full" disabled={isStartingCamera || livenessStep === 'awaiting_models' || livenessStep === 'awaiting_camera_for_video'}>
          <UserCheck className="mr-2" /> Iniciar Verificación Humana
        </Button>
      )}
      
      {/* Button that triggers MediaRecorder to start if camera is ready */}
       {livenessStep === 'ready_to_record' && isCameraActive && !isRecording && !isVerifyingWithAPI && (
        <Button onClick={() => { /* Logic moved to useEffect based on 'ready_to_record' */ }} className="w-full" disabled={true}>
            <Video className="mr-2" /> Preparando para grabar...
        </Button>
      )}


      {isVerifyingWithAPI && (
        <Button className="w-full" disabled>
            <UploadCloud className="mr-2 animate-pulse" /> Verificando Video...
        </Button>
      )}

      {/* Button for Final Face Capture (after liveness is passed) */}
      {livenessStep === 'final_capture_ready' && isCameraActive && !isProcessingFinalCapture && (
        <Button onClick={handleFinalCapture} className="w-full bg-green-600 hover:bg-green-700">
          <Camera className="mr-2" /> {mainCaptureButtonTextIfLive}
        </Button>
      )}
      {isProcessingFinalCapture && (
         <Button className="w-full" disabled>
            <Loader2 className="mr-2 animate-spin" /> Procesando Captura...
        </Button>
      )}


      {(livenessStep === 'human_verification_failed' || error) && !isStartingCamera && !isRecording && !isVerifyingWithAPI && (
        <Button onClick={handleRetry} className="w-full" variant="outline">
          <AlertTriangle className="mr-2"/> Reintentar Verificación
        </Button>
      )}
    </div>
  );
};

export default FaceCapture;
