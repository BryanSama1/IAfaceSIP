
"use client";

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, Video, UploadCloud, UserCheck, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import * as faceapi from 'face-api.js';

interface FaceCaptureProps {
  onFaceCaptured: (dataUrl: string | null, descriptor: number[] | null, livenessVerificationPassed?: boolean) => void;
  initialButtonText?: string;
  mainCaptureButtonTextIfLive?: string;
  context: 'login' | 'signup' | 'admin_update';
  isParentProcessing?: boolean;
}

type LivenessStep =
  | 'initial'
  | 'awaiting_models'
  | 'awaiting_camera_for_video'
  | 'recording_video'
  | 'verifying_video_with_api'
  | 'liveness_api_passed_awaiting_final_camera' 
  | 'liveness_api_passed_ready_for_manual_final_capture'
  | 'final_capture_active' 
  | 'processing_final_capture' 
  | 'liveness_failed_or_error';

const VIDEO_RECORDING_DURATION_MS = 5000;
const MAX_VIDEO_SIZE_MB = 6;

const FaceCapture: React.FC<FaceCaptureProps> = ({
  onFaceCaptured,
  initialButtonText = "Iniciar Verificación Humana",
  mainCaptureButtonTextIfLive = "Capturar Rostro",
  context,
  isParentProcessing = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectionCanvasRef = useRef<HTMLCanvasElement>(null);

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

  const modelsLoadedRef = useRef(false);
  const { toast } = useToast();
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Refs for values used in callbacks that should not cause re-execution of useCallback itself
  const livenessStepRef = useRef(livenessStep);
  const isRecordingRef = useRef(isRecording);
  const isCameraActiveRef = useRef(isCameraActive);

  useEffect(() => { livenessStepRef.current = livenessStep; }, [livenessStep]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isCameraActiveRef.current = isCameraActive; }, [isCameraActive]);


  const stopCamera = useCallback((calledFrom?: string) => {
    console.log(`FaceCapture: stopCamera llamado desde: ${calledFrom || 'desconocido'}. Current stream state: ${currentStream ? 'exists' : 'null'}`);
    
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }

    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        console.log("FaceCapture: MediaRecorder detenido desde stopCamera.");
      }
      mediaRecorderRef.current = null; 
    }
    
    const videoElement = videoRef.current;
    if (videoElement && videoElement.srcObject) {
      const stream = videoElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoElement.srcObject = null;
      console.log("FaceCapture: Pistas del flujo de medios detenidas y srcObject anulado (desde videoRef).");
    }
    
    // Explicitly check currentStream from state before setting to null
    // to avoid issues if it was already null.
    if (currentStream) {
        console.log("FaceCapture: Setting currentStream to null in stopCamera.");
        setCurrentStream(null); // This will trigger the useEffect for currentStream to clean up isCameraActive
    } else {
        // If currentStream is already null, ensure isCameraActive is also false.
        if (isCameraActiveRef.current) { // Use ref to avoid stale closure
            setIsCameraActive(false);
            isCameraActiveRef.current = false;
        }
    }
  }, [currentStream, setCurrentStream, setIsCameraActive]);


  const loadModels = useCallback(async () => {
    if (modelsLoadedRef.current) {
      setStatusMessage("Modelos faciales ya cargados.");
      if (livenessStepRef.current !== 'initial') setLivenessStep('initial');
      return;
    }
    setLivenessStep('awaiting_models');
    const MODEL_URL = '/models';
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
      modelsLoadedRef.current = true;
      setLivenessStep('initial');
    } catch (e) {
      const errorMsg = `Error cargando modelos: ${e instanceof Error ? e.message : String(e)}.`;
      setError(errorMsg);
      setLivenessStep('liveness_failed_or_error');
      toast({ title: "Error en Modelos Faciales", description: errorMsg, variant: "destructive", duration: 7000 });
    }
  }, [toast]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);


  const startRecordingSequence = useCallback(async (stream: MediaStream) => {
    console.log("FaceCapture: startRecordingSequence llamado.");
    if (isRecordingRef.current) { // Use ref
      console.warn("FaceCapture: Intento de iniciar grabación cuando ya se está grabando.");
      return;
    }
    if (!stream || stream.getTracks().length === 0 || !stream.active) {
      console.error("FaceCapture: startRecordingSequence llamado con un stream inválido o inactivo.");
      setError("Error interno: el flujo de la cámara no está activo para la grabación.");
      setLivenessStep('liveness_failed_or_error');
      stopCamera('invalid_stream_in_startRecordingSequence');
      return;
    }

    setIsRecording(true);
    setLivenessStep('recording_video');
    recordedChunksRef.current = []; 

    try {
      const options = { mimeType: 'video/webm;codecs=vp8' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          console.warn(`${options.mimeType} no es soportado, intentando con default.`);
          // @ts-ignore
          delete options.mimeType;
      }
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        console.log("FaceCapture: MediaRecorder.onstop disparado.");
        setIsRecording(false); // Important to set before async operations
        const videoBlob = new Blob(recordedChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'video/webm' });
        recordedChunksRef.current = []; 
        const tempMediaRecorderMimeType = mediaRecorderRef.current?.mimeType;
        mediaRecorderRef.current = null; // Release MediaRecorder instance

        let loginFrameDataUrl: string | null = null;
        let loginFrameDescriptor: number[] | null = null;

        if (context === 'login' && videoRef.current && captureCanvasRef.current && modelsLoadedRef.current) {
          if (videoRef.current.readyState >= videoRef.current.HAVE_CURRENT_DATA && videoRef.current.videoWidth > 0) {
            const video = videoRef.current;
            const canvas = captureCanvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              loginFrameDataUrl = canvas.toDataURL('image/png');
              try {
                const detection = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
                  .withFaceLandmarks().withFaceDescriptor();
                if (detection) {
                  loginFrameDescriptor = Array.from(detection.descriptor);
                }
              } catch (e) { console.error("FaceCapture: Error en descriptor de cuadro para login:", e); }
            }
          }
        }
        
        stopCamera('video_recording_finished_before_api_call');
        setLivenessStep('verifying_video_with_api');
        setIsVerifyingWithAPI(true);

        if (videoBlob.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
          toast({ title: "Video Demasiado Grande", description: `El video grabado excede los ${MAX_VIDEO_SIZE_MB}MB. Intenta de nuevo.`, variant: "destructive" });
          setError(`Video demasiado grande (${(videoBlob.size / (1024*1024)).toFixed(2)} MB)`);
          onFaceCaptured(null, null, false);
          setLivenessStep('liveness_failed_or_error');
          setIsVerifyingWithAPI(false);
          return;
        }

        const formData = new FormData();
        formData.append("prompt", "Verifica si la persona en el video es real y viva.");
        formData.append("video_file", videoBlob, `liveness_video.${tempMediaRecorderMimeType?.split('/')[1].split(';')[0] || 'webm'}`);
        try {
          const response = await fetch("https://facesip-ia-127465468754.us-central1.run.app", { method: "POST", body: formData });
          if (!response.ok) throw new Error(`Error de API: ${response.status} ${response.statusText}`);
          const outerResponse = await response.json();
          let isLivePerson = false;
          try {
              const innerJsonResponseString = outerResponse.response;
              const innerJsonResponse = JSON.parse(innerJsonResponseString);
              const finalDataString = innerJsonResponse.response;
              const finalData = JSON.parse(finalDataString);
              isLivePerson = finalData.isLivePerson === true;
          } catch (parseError) { throw new Error("Respuesta de API malformada."); }

          if (isLivePerson) {
            if (context === 'login') {
              onFaceCaptured(loginFrameDataUrl, loginFrameDescriptor, true);
              // LivenessForm will handle UI changes based on onFaceCaptured result.
              // For login, we might want to briefly show success then let LoginForm decide next step.
              setLivenessStep('liveness_api_passed_awaiting_final_camera'); // Indicate liveness passed, login form will take over
            } else { 
              toast({ title: "Verificación Humana Exitosa", description: "Persona real detectada. Puedes proceder a la captura final.", duration: 3000 });
              setLivenessStep('liveness_api_passed_ready_for_manual_final_capture');
            }
          } else {
            toast({ title: "Verificación Humana Fallida", description: "No se pudo confirmar que eres una persona real. Intenta de nuevo.", variant: "destructive", duration: 5000 });
            setError("Verificación de vida fallida. Asegura buena iluminación y mira a la cámara.");
            onFaceCaptured(null, null, false);
            setLivenessStep('liveness_failed_or_error');
          }
        } catch (apiError) {
          const apiErrorMsg = apiError instanceof Error ? apiError.message : String(apiError);
          toast({ title: "Error de Verificación", description: `No se pudo completar la verificación: ${apiErrorMsg}`, variant: "destructive" });
          setError(`Error de comunicación con el servicio de verificación: ${apiErrorMsg}`);
          onFaceCaptured(null, null, false);
          setLivenessStep('liveness_failed_or_error');
        } finally { setIsVerifyingWithAPI(false); }
      };

      mediaRecorderRef.current.start();
      console.log("FaceCapture: MediaRecorder iniciado.");
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          console.log("FaceCapture: MediaRecorder detenido por timeout.");
        }
      }, VIDEO_RECORDING_DURATION_MS);
    } catch (mediaRecorderError) {
      console.error("FaceCapture: ERROR DENTRO DE startRecordingSequence al crear o iniciar MediaRecorder", mediaRecorderError);
      const mrErrorMsg = mediaRecorderError instanceof Error ? mediaRecorderError.message : String(mediaRecorderError);
      toast({ title: "Error de Grabación", description: `No se pudo iniciar la grabación de video. ${mrErrorMsg}`, variant: "destructive" });
      setIsRecording(false);
      setError(`Error al iniciar la grabación: ${mrErrorMsg}`);
      stopCamera('media_recorder_init_error_in_startRecordingSequence');
      onFaceCaptured(null, null, false); 
      setLivenessStep('liveness_failed_or_error');
    }
  }, [context, onFaceCaptured, stopCamera, toast, setIsRecording, setLivenessStep, setError, setIsVerifyingWithAPI]);


  const startCamera = useCallback(async (purpose: 'video_liveness' | 'final_capture') => {
    if (isStartingCamera) {
        console.log("FaceCapture: startCamera llamado mientras ya se está iniciando, retornando.");
        return;
    }
    if (currentStream && isCameraActiveRef.current) { // use Ref
      console.log("FaceCapture: startCamera llamado pero la cámara ya está activa y con stream.");
      if (purpose === 'video_liveness' && context === 'login' && livenessStepRef.current === 'awaiting_camera_for_video' && !isRecordingRef.current) {
         startRecordingSequence(currentStream);
      } else if (purpose === 'final_capture' && livenessStepRef.current !== 'final_capture_active' && (context === 'signup' || context === 'admin_update')) {
        if (isCameraActiveRef.current) setLivenessStep('final_capture_active');
      }
      return;
    }

    setError(null);
    setIsStartingCamera(true);
    setLivenessStep(purpose === 'video_liveness' ? 'awaiting_camera_for_video' : 'liveness_api_passed_awaiting_final_camera');
    
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      console.log("FaceCapture: startCamera - Stream obtenido de getUserMedia.");
      setCurrentStream(mediaStream); 
    } catch (err) {
      let message = err instanceof Error ? `${err.name}: ${err.message}` : "Error desconocido de cámara.";
      if (err instanceof Error && err.name === "NotAllowedError") message = "Permiso de cámara denegado.";
      console.error("FaceCapture: startCamera - Error en getUserMedia:", message, err);
      setError(message);
      setLivenessStep('liveness_failed_or_error');
      toast({ title: "Error de Cámara", description: message, variant: "destructive" });
      setCurrentStream(null); // Asegurar que currentStream es null si falla
    } finally {
      setIsStartingCamera(false);
    }
  }, [isStartingCamera, currentStream, context, startRecordingSequence, toast, setIsStartingCamera, setCurrentStream, setError, setLivenessStep]);


  useEffect(() => {
    const videoNode = videoRef.current;
    if (!videoNode) return;

    let aborted = false;

    if (currentStream) {
        console.log("FaceCapture: useEffect[currentStream] - Stream detectado. Asignando a video.");
        if (videoNode.srcObject !== currentStream) {
            videoNode.srcObject = currentStream;
        }

        const handleLoadedMetadata = () => {
            if (aborted || !videoNode) return;
            console.log("FaceCapture: useEffect[currentStream] - Evento 'loadedmetadata' en video.");
            videoNode.play()
                .then(() => {
                    if (aborted) return;
                    console.log("FaceCapture: useEffect[currentStream] - video.play() exitoso.");
                    if (!isCameraActiveRef.current) {
                         setIsCameraActive(true); // Update state via setter
                         isCameraActiveRef.current = true; // Keep ref in sync
                    }

                    if (context === 'login' && livenessStepRef.current === 'awaiting_camera_for_video' && !isRecordingRef.current) {
                        console.log("FaceCapture: useEffect[currentStream] - play() ok. Iniciando grabación para LOGIN.");
                        startRecordingSequence(currentStream);
                    }
                })
                .catch(playError => {
                    if (aborted) return;
                    const errorMsg = `Error reproducción: ${playError instanceof Error ? playError.message : String(playError)}`;
                    console.error("FaceCapture: useEffect[currentStream] - Error al reproducir video:", playError);
                    setError(errorMsg);
                    setLivenessStep('liveness_failed_or_error');
                    stopCamera('play_error_in_effect_currentStream'); 
                });
        };

        videoNode.addEventListener('loadedmetadata', handleLoadedMetadata);
        
        // If video metadata is already loaded (e.g., stream reused quickly)
        if (videoNode.readyState >= HTMLMediaElement.HAVE_METADATA) {
            console.log("FaceCapture: useEffect[currentStream] - Video ya tiene metadata, llamando a handler.");
            handleLoadedMetadata();
        }

        return () => {
            aborted = true;
            console.log("FaceCapture: useEffect[currentStream] - Limpiando listener 'loadedmetadata'.");
            videoNode.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
    } else { // currentStream es null
        console.log("FaceCapture: useEffect[currentStream] - currentStream es null. Limpiando video y estado de cámara activa.");
        if (videoNode.srcObject) { // srcObject might still be there from a previous stream
            const stream = videoNode.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoNode.srcObject = null;
        }
        if (isCameraActiveRef.current) {
            setIsCameraActive(false);
            isCameraActiveRef.current = false;
        }
    }
  }, [currentStream, context, startRecordingSequence, stopCamera, setIsCameraActive, setError, setLivenessStep]);


  useEffect(() => {
    if (isCameraActiveRef.current) { // Use ref
      if (livenessStepRef.current === 'liveness_api_passed_awaiting_final_camera' && (context === 'signup' || context === 'admin_update')) {
        setLivenessStep('final_capture_active');
      }
    }
  }, [isCameraActive, context, setLivenessStep]); // isCameraActive (state) dependency is fine here for this specific transition logic
  
  useEffect(() => {
    let message = "";
    // Using livenessStep directly here as this effect is about reflecting current state to UI
    switch(livenessStep) {
      case 'initial':
        message = modelsLoadedRef.current ? "Listo para iniciar verificación." : "Cargando modelos...";
        if (context === 'login' && isParentProcessing) message = "Procesando inicio de sesión...";
        break;
      case 'awaiting_models': message = "Cargando modelos de reconocimiento facial..."; break;
      case 'awaiting_camera_for_video': message = error ? error : (isStartingCamera ? "Iniciando cámara..." : "Preparando cámara para grabación..."); break;
      case 'recording_video': message = "Grabando video de verificación (5s)..."; break;
      case 'verifying_video_with_api': message = "Enviando video para verificación de vida..."; break;
      case 'liveness_api_passed_awaiting_final_camera':
         message = context === 'login' ? "Verificación humana exitosa. Procesando reconocimiento facial..." : "Verificación humana exitosa. Preparando cámara para captura final...";
        break;
      case 'liveness_api_passed_ready_for_manual_final_capture': message = "¡Verificado! Ahora puedes capturar tu rostro."; break;
      case 'final_capture_active': message = "Cámara lista para captura final manual. Buscando rostro..."; break;
      case 'processing_final_capture': message = "Procesando imagen final..."; break;
      case 'liveness_failed_or_error': message = error || "Verificación fallida. Intenta de nuevo."; break;
      default: message = "Procesando...";
    }
    setStatusMessage(message);
  }, [livenessStep, error, context, isParentProcessing, isStartingCamera]);


  const handleStartHumanVerification = useCallback(async () => {
    console.log("FaceCapture: handleStartHumanVerification llamado. LivenessStep actual:", livenessStepRef.current);
    if (!modelsLoadedRef.current) {
      toast({ title: "Modelos no cargados", description: "Los modelos de reconocimiento facial aún se están cargando.", variant: "default" });
      return;
    }
    setError(null); // Clear previous errors
    // Reset relevant states if retrying from a non-initial state, though `handleRetry` is better for full resets
    if (livenessStepRef.current !== 'initial') {
        setIsRecording(false);
        setIsVerifyingWithAPI(false);
        // stopCamera('pre_verification_start_if_not_initial'); // Ensure camera is stopped before starting a new attempt
    }
    await startCamera('video_liveness');
  }, [startCamera, toast, setError, setIsRecording, setIsVerifyingWithAPI]);
  
  useEffect(() => {
    if (livenessStepRef.current === 'liveness_api_passed_ready_for_manual_final_capture' && (context === 'signup' || context === 'admin_update')) {
      startCamera('final_capture');
    }
  }, [livenessStep, context, startCamera]); // livenessStep (state) dependency here for this transition

  useEffect(() => {
    if (livenessStepRef.current === 'final_capture_active' && isCameraActiveRef.current && modelsLoadedRef.current && !detectionIntervalRef.current && videoRef.current && (context === 'signup' || context === 'admin_update')) {
        const video = videoRef.current;
        const canvas = detectionCanvasRef.current;
        if (!canvas) return;
        console.log("FaceCapture: Iniciando intervalo de detección para captura final manual.");
        detectionIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || video.paused || video.ended || video.readyState < video.HAVE_ENOUGH_DATA) {
                return;
            }
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            if (displaySize.width === 0 || displaySize.height === 0) {
                return;
            }
            faceapi.matchDimensions(canvas, displaySize);
            const detectionsResults = await faceapi
              .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
              .withFaceLandmarks();
            const context2D = canvas.getContext('2d');
            if (!context2D) return;
            context2D.clearRect(0, 0, canvas.width, canvas.height);
            if (detectionsResults) {
                const resizedDetections = faceapi.resizeResults(detectionsResults, displaySize);
                faceapi.draw.drawDetections(canvas, resizedDetections);
            }
        }, 250);
    } else if ((livenessStepRef.current !== 'final_capture_active' || !isCameraActiveRef.current || context === 'login') && detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
        if(detectionCanvasRef.current) {
            const context2D = detectionCanvasRef.current.getContext('2d');
            context2D?.clearRect(0, 0, detectionCanvasRef.current.width, detectionCanvasRef.current.height);
        }
    }
    return () => {
        if (detectionIntervalRef.current) {
            clearInterval(detectionIntervalRef.current);
        }
    };
  }, [livenessStep, isCameraActive, context]); // livenessStep & isCameraActive (state) dependencies are fine for detection interval

  const handleManualFinalCapture = useCallback(async () => {
    if (!videoRef.current || !captureCanvasRef.current || !currentStream || !isCameraActiveRef.current ||
        livenessStepRef.current !== 'final_capture_active' || !(context === 'signup' || context === 'admin_update')) {
      toast({ title: "Error de Captura", description: "La cámara no está lista o no se ha verificado la identidad.", variant: "destructive" });
      return;
    }
    setIsProcessingFinalCapture(true);
    setLivenessStep('processing_final_capture');
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context2D = canvas.getContext('2d');
    if (context2D) context2D.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
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
    onFaceCaptured(dataUrl, descriptor, true); 
    stopCamera('manual_final_capture_complete');
    setIsProcessingFinalCapture(false);
    setLivenessStep('initial'); // Reset to initial state after capture
  }, [currentStream, context, onFaceCaptured, stopCamera, toast, setIsProcessingFinalCapture, setLivenessStep]);

  const handleRetry = useCallback(() => {
    console.log("FaceCapture: handleRetry llamado.");
    stopCamera('retry_button');
    setError(null);
    setIsRecording(false);
    setIsVerifyingWithAPI(false);
    setIsProcessingFinalCapture(false);
    setLivenessStep('initial'); // This should make the initial button show
    if (!modelsLoadedRef.current) {
        loadModels();
    }
  }, [stopCamera, setError, setIsRecording, setIsVerifyingWithAPI, setIsProcessingFinalCapture, setLivenessStep, loadModels]);

  useEffect(() => {
    return () => {
      console.log("FaceCapture: Desmontando componente, llamando a stopCamera.");
      stopCamera('component_unmount');
    };
  }, [stopCamera]);

  const imageSize = 320;
  const previewStyle = { width: `${imageSize}px`, height: `${imageSize * 0.75}px` };

  // Conditions for button visibility - using direct state values
  const showInitialButton = (
      livenessStep === 'initial' || 
      // For login, if liveness passed but parent is not yet processing or failed, allow restart.
      // However, if parent IS processing, button should be disabled (handled by isParentProcessing prop)
      (livenessStep === 'liveness_api_passed_awaiting_final_camera' && context === 'login' && !isParentProcessing)
    ) && modelsLoadedRef.current && !error && !isStartingCamera && !isRecording && !isVerifyingWithAPI;

  const showRetryButton = livenessStep === 'liveness_failed_or_error' && !isStartingCamera && !isRecording && !isVerifyingWithAPI && !isProcessingFinalCapture;
  const showManualFinalCaptureButton = (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' || livenessStep === 'final_capture_active') && isCameraActive && !isProcessingFinalCapture && (context === 'signup' || context === 'admin_update');
  
  console.log(`FaceCapture RENDER: livenessStep=${livenessStep}, isCameraActive=${isCameraActive}, isRecording=${isRecording}, isStartingCamera=${isStartingCamera}, error=${error}, isParentProcessing=${isParentProcessing}, showInitialButton=${showInitialButton}`);


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
        <canvas
            ref={detectionCanvasRef}
            className={cn("absolute top-0 left-0 object-cover transform scaleX-[-1]", { 'hidden': !isCameraActive || livenessStep !== 'final_capture_active' || context === 'login' })}
            style={previewStyle}
        />
        {!isCameraActive && (livenessStep === 'initial' || livenessStep === 'awaiting_models' || livenessStep === 'awaiting_camera_for_video' || (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && (context === 'signup' || context === 'admin_update')) ) && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/80 p-4 text-center">
                {(isStartingCamera || livenessStep === 'awaiting_models' || (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && (isStartingCamera || !isCameraActive)) || livenessStep === 'awaiting_camera_for_video' ) && <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />}
                <p className="text-sm text-foreground">{statusMessage}</p>
             </div>
        )}
        {isRecording && (
            <div className="absolute top-2 right-2 flex items-center gap-2 bg-red-500 text-white px-2 py-1 rounded-md text-xs">
                <Video className="h-3 w-3" /> GRABANDO
            </div>
        )}
      </div>
      <canvas ref={captureCanvasRef} className="hidden"></canvas>

      {statusMessage && (livenessStep !== 'initial' || error || (context === 'login' && isParentProcessing) ) && (
        <div className={cn("p-2 rounded-md text-center text-sm w-full",
            {'bg-green-100 text-green-700': livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' || (livenessStep === 'final_capture_active' && (context === 'signup' || context === 'admin_update')) || (livenessStep === 'liveness_api_passed_awaiting_final_camera' && context !== 'login')},
            {'bg-red-100 text-red-700': livenessStep === 'liveness_failed_or_error' || error },
            {'bg-blue-100 text-blue-700': livenessStep !== 'liveness_api_passed_ready_for_manual_final_capture' && livenessStep !== 'liveness_api_passed_awaiting_final_camera' && livenessStep !== 'liveness_failed_or_error' && !error && !(livenessStep === 'final_capture_active' && (context === 'signup' || context === 'admin_update'))}
        )}>
          {statusMessage}
        </div>
      )}

      {showInitialButton && (
        <Button 
          onClick={handleStartHumanVerification} 
          className="w-full" 
          disabled={
            isStartingCamera || // Already trying to start
            isRecording || // Already recording
            isVerifyingWithAPI || // Already verifying
            !modelsLoadedRef.current || 
            (context === 'login' && isParentProcessing) // Parent is busy
          }
        >
          {context === 'login' && isParentProcessing ? <Loader2 className="mr-2 animate-spin" /> : <UserCheck className="mr-2" />}
          {context === 'login' && isParentProcessing ? "Procesando inicio de sesión..." : initialButtonText}
        </Button>
      )}

      {isVerifyingWithAPI && (
        <Button className="w-full" disabled>
            <UploadCloud className="mr-2 animate-pulse" /> Verificando Video...
        </Button>
      )}

      {showManualFinalCaptureButton && (
        <Button onClick={handleManualFinalCapture} className="w-full bg-green-600 hover:bg-green-700" disabled={isProcessingFinalCapture || isStartingCamera || !isCameraActive}>
          <Camera className="mr-2" /> {mainCaptureButtonTextIfLive}
        </Button>
      )}
      {isProcessingFinalCapture && (context === 'signup' || context === 'admin_update') && (
         <Button className="w-full" disabled>
            <Loader2 className="mr-2 animate-spin" /> Procesando Captura Manual...
        </Button>
      )}
      {livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && (context === 'signup' || context === 'admin_update') && (isStartingCamera || !isCameraActive) && !showManualFinalCaptureButton && (
         <Button className="w-full" disabled>
            <Loader2 className="mr-2 animate-spin" /> Preparando cámara para captura final...
        </Button>
      )}

      {showRetryButton && (
        <Button onClick={handleRetry} className="w-full" variant="outline">
          <RefreshCw className="mr-2"/> Reintentar Verificación
        </Button>
      )}
    </div>
  );
};

export default FaceCapture;
