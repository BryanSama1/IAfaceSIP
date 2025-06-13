
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
  mainCaptureButtonTextIfLive?: string; // Todavía usado por admin_update
  context: 'login' | 'signup' | 'admin_update';
  isParentProcessing?: boolean;
}

type LivenessStep =
  | 'initial'
  | 'awaiting_models'
  | 'awaiting_camera_for_video'
  | 'recording_video'
  | 'verifying_video_with_api'
  | 'liveness_api_passed_processing_final_for_signup_login' // Nuevo estado para login/signup post-liveness
  | 'liveness_api_passed_ready_for_manual_final_capture' // Para admin_update
  | 'final_capture_active' // Para admin_update
  | 'processing_final_capture' // Para admin_update
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
  const [isProcessingFinalCapture, setIsProcessingFinalCapture] = useState(false); // Usado por admin_update y ahora también por signup/login post-liveness

  const modelsLoadedRef = useRef(false);
  const { toast } = useToast();
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
    
    if (currentStream) {
        console.log("FaceCapture: Setting currentStream to null in stopCamera.");
        setCurrentStream(null); 
    } else {
        if (isCameraActiveRef.current) { 
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
    if (isRecordingRef.current) { 
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
        setIsRecording(false); 
        const videoBlob = new Blob(recordedChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'video/webm' });
        recordedChunksRef.current = []; 
        const tempMediaRecorderMimeType = mediaRecorderRef.current?.mimeType;
        mediaRecorderRef.current = null; 
        
        stopCamera('video_recording_finished_before_api_call'); // Stop camera before API call for liveness
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
            if (context === 'login' || context === 'signup') {
              setLivenessStep('liveness_api_passed_processing_final_for_signup_login');
              setIsProcessingFinalCapture(true); // Re-using this state for the automatic capture phase
              
              // Need to restart camera briefly to get a still frame if it was stopped
              // Or, if videoRef.current still holds the last frame from the recording stream, use that.
              // For simplicity, let's try to use the videoRef if it's still valid.
              // A better approach might be to capture frame *before* stopping camera or use a new capture sequence.
              // For now, let's assume videoRef.current might be usable or restart camera.
              
              // Restart camera for final capture
              const tempStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
              if (videoRef.current) {
                videoRef.current.srcObject = tempStream;
                await videoRef.current.play(); // Ensure video is playing to get a frame
                
                // Wait a moment for video to stabilize
                await new Promise(resolve => setTimeout(resolve, 500));


                let frameDataUrl: string | null = null;
                let frameDescriptor: number[] | null = null;

                if (videoRef.current && captureCanvasRef.current && modelsLoadedRef.current) {
                  if (videoRef.current.readyState >= videoRef.current.HAVE_CURRENT_DATA && videoRef.current.videoWidth > 0) {
                    const video = videoRef.current;
                    const canvas = captureCanvasRef.current;
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                      frameDataUrl = canvas.toDataURL('image/png');
                      try {
                        const detection = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
                          .withFaceLandmarks().withFaceDescriptor();
                        if (detection) {
                          frameDescriptor = Array.from(detection.descriptor);
                        } else {
                           toast({ title: "Captura Facial Fallida", description: "No se detectó un rostro en el cuadro. Intenta de nuevo.", variant: "destructive" });
                        }
                      } catch (e) { 
                        console.error("FaceCapture: Error en descriptor de cuadro para login/signup:", e); 
                        toast({ title: "Error de Descriptor", description: "No se pudo procesar el descriptor facial.", variant: "destructive" });
                      }
                    }
                  } else {
                     toast({ title: "Error de Cámara", description: "No se pudo obtener un cuadro de la cámara.", variant: "destructive" });
                  }
                }
                onFaceCaptured(frameDataUrl, frameDescriptor, true);
                tempStream.getTracks().forEach(track => track.stop()); // Stop this temporary stream
                setIsProcessingFinalCapture(false);
                setLivenessStep('initial'); // Reset after successful capture
              } else {
                 onFaceCaptured(null, null, true); // Liveness passed, but frame capture failed
                 setIsProcessingFinalCapture(false);
                 setLivenessStep('liveness_failed_or_error'); // Indicate error state
              }
            } else if (context === 'admin_update') {
              toast({ title: "Verificación Humana Exitosa", description: "Persona real detectada. Puedes proceder a la captura final.", duration: 3000 });
              setLivenessStep('liveness_api_passed_ready_for_manual_final_capture');
            }
          } else { // Liveness failed
            toast({ title: "Verificación Humana Fallida", description: "No se pudo confirmar que eres una persona real. Intenta de nuevo.", variant: "destructive", duration: 5000 });
            setError("Verificación de vida fallida. Asegura buena iluminación y mira a la cámara.");
            onFaceCaptured(null, null, false); // Liveness failed
            setLivenessStep('liveness_failed_or_error');
          }
        } catch (apiError) {
          const apiErrorMsg = apiError instanceof Error ? apiError.message : String(apiError);
          toast({ title: "Error de Verificación", description: `No se pudo completar la verificación: ${apiErrorMsg}`, variant: "destructive" });
          setError(`Error de comunicación con el servicio de verificación: ${apiErrorMsg}`);
          onFaceCaptured(null, null, false);
          setLivenessStep('liveness_failed_or_error');
        } finally { 
          setIsVerifyingWithAPI(false); 
          // No reset livenessStep here if it's 'liveness_api_passed_processing_final_for_signup_login' or 'liveness_api_passed_ready_for_manual_final_capture'
        }
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
  }, [context, onFaceCaptured, stopCamera, toast, setIsRecording, setLivenessStep, setError, setIsVerifyingWithAPI, setIsProcessingFinalCapture]);


  const startCamera = useCallback(async (purpose: 'video_liveness' | 'final_capture_admin') => {
    if (isStartingCamera) {
        console.log("FaceCapture: startCamera llamado mientras ya se está iniciando, retornando.");
        return;
    }
    if (currentStream && isCameraActiveRef.current) { 
      console.log("FaceCapture: startCamera llamado pero la cámara ya está activa y con stream.");
      if (purpose === 'video_liveness' && (context === 'login' || context === 'signup') && livenessStepRef.current === 'awaiting_camera_for_video' && !isRecordingRef.current) {
         startRecordingSequence(currentStream);
      } else if (purpose === 'final_capture_admin' && livenessStepRef.current !== 'final_capture_active' && context === 'admin_update') {
        if (isCameraActiveRef.current) setLivenessStep('final_capture_active');
      }
      return;
    }

    setError(null);
    setIsStartingCamera(true);
    setLivenessStep(purpose === 'video_liveness' ? 'awaiting_camera_for_video' : 'liveness_api_passed_ready_for_manual_final_capture'); // final_capture_admin uses this
    
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
      setCurrentStream(null); 
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
        if (videoNode.srcObject !== currentStream) videoNode.srcObject = currentStream;

        const handleLoadedMetadata = () => {
            if (aborted || !videoNode) return;
            console.log("FaceCapture: useEffect[currentStream] - Evento 'loadedmetadata' en video.");
            videoNode.play()
                .then(() => {
                    if (aborted) return;
                    console.log("FaceCapture: useEffect[currentStream] - video.play() exitoso.");
                    if (!isCameraActiveRef.current) {
                         setIsCameraActive(true); 
                         isCameraActiveRef.current = true; 
                    }
                    if ((context === 'login' || context === 'signup') && livenessStepRef.current === 'awaiting_camera_for_video' && !isRecordingRef.current) {
                        console.log("FaceCapture: useEffect[currentStream] - play() ok. Iniciando grabación para LOGIN/SIGNUP.");
                        startRecordingSequence(currentStream);
                    } else if (context === 'admin_update' && livenessStepRef.current === 'liveness_api_passed_ready_for_manual_final_capture') {
                        setLivenessStep('final_capture_active'); // For admin manual capture
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
        if (videoNode.readyState >= HTMLMediaElement.HAVE_METADATA) handleLoadedMetadata();
        return () => {
            aborted = true;
            videoNode.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
    } else { 
        console.log("FaceCapture: useEffect[currentStream] - currentStream es null. Limpiando video y estado de cámara activa.");
        if (videoNode.srcObject) {
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
    let message = "";
    switch(livenessStep) {
      case 'initial':
        message = modelsLoadedRef.current ? "Listo para iniciar verificación." : "Cargando modelos...";
        if ((context === 'login' || context === 'signup') && isParentProcessing) message = `Procesando ${context === 'login' ? 'inicio de sesión' : 'registro'}...`;
        break;
      case 'awaiting_models': message = "Cargando modelos de reconocimiento facial..."; break;
      case 'awaiting_camera_for_video': message = error ? error : (isStartingCamera ? "Iniciando cámara..." : "Preparando cámara para grabación..."); break;
      case 'recording_video': message = "Grabando video de verificación (5s)..."; break;
      case 'verifying_video_with_api': message = "Enviando video para verificación de vida..."; break;
      case 'liveness_api_passed_processing_final_for_signup_login':
        message = `Verificación humana exitosa. Procesando ${context === 'login' ? 'reconocimiento facial' : 'datos de registro'}...`;
        break;
      case 'liveness_api_passed_ready_for_manual_final_capture': // admin_update
        message = "¡Verificado! Ahora puedes capturar el nuevo rostro.";
        break;
      case 'final_capture_active': // admin_update
        message = "Cámara lista para captura final manual. Buscando rostro...";
        break;
      case 'processing_final_capture': // admin_update
        message = "Procesando imagen final...";
        break;
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
    setError(null); 
    if (livenessStepRef.current !== 'initial') {
        setIsRecording(false);
        setIsVerifyingWithAPI(false);
        setIsProcessingFinalCapture(false);
    }
    await startCamera('video_liveness');
  }, [startCamera, toast, setError, setIsRecording, setIsVerifyingWithAPI, setIsProcessingFinalCapture]);
  
  useEffect(() => { // For admin_update to start final capture camera
    if (livenessStepRef.current === 'liveness_api_passed_ready_for_manual_final_capture' && context === 'admin_update') {
      startCamera('final_capture_admin');
    }
  }, [livenessStep, context, startCamera]); 

  useEffect(() => { // Face detection drawing for admin_update manual capture
    if (livenessStepRef.current === 'final_capture_active' && isCameraActiveRef.current && modelsLoadedRef.current && !detectionIntervalRef.current && videoRef.current && context === 'admin_update') {
        const video = videoRef.current;
        const canvas = detectionCanvasRef.current;
        if (!canvas) return;
        console.log("FaceCapture: Iniciando intervalo de detección para captura final manual (admin).");
        detectionIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || video.paused || video.ended || video.readyState < video.HAVE_ENOUGH_DATA) return;
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            if (displaySize.width === 0 || displaySize.height === 0) return;
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
    } else if ((livenessStepRef.current !== 'final_capture_active' || !isCameraActiveRef.current || context !== 'admin_update') && detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
        if(detectionCanvasRef.current) {
            const context2D = detectionCanvasRef.current.getContext('2d');
            context2D?.clearRect(0, 0, detectionCanvasRef.current.width, detectionCanvasRef.current.height);
        }
    }
    return () => { if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current); };
  }, [livenessStep, isCameraActive, context]); 

  const handleManualFinalCaptureAdmin = useCallback(async () => { // Renamed to be specific
    if (!videoRef.current || !captureCanvasRef.current || !currentStream || !isCameraActiveRef.current ||
        livenessStepRef.current !== 'final_capture_active' || context !== 'admin_update') {
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
    stopCamera('manual_final_capture_admin_complete');
    setIsProcessingFinalCapture(false);
    setLivenessStep('initial'); 
  }, [currentStream, context, onFaceCaptured, stopCamera, toast, setIsProcessingFinalCapture, setLivenessStep]);

  const handleRetry = useCallback(() => {
    console.log("FaceCapture: handleRetry llamado.");
    stopCamera('retry_button');
    setError(null);
    setIsRecording(false);
    setIsVerifyingWithAPI(false);
    setIsProcessingFinalCapture(false);
    setLivenessStep('initial'); 
    if (!modelsLoadedRef.current) loadModels();
  }, [stopCamera, setError, setIsRecording, setIsVerifyingWithAPI, setIsProcessingFinalCapture, setLivenessStep, loadModels]);

  useEffect(() => {
    return () => {
      console.log("FaceCapture: Desmontando componente, llamando a stopCamera.");
      stopCamera('component_unmount');
    };
  }, [stopCamera]);

  const imageSize = 320;
  const previewStyle = { width: `${imageSize}px`, height: `${imageSize * 0.75}px` };

  const showInitialButton = (
      livenessStep === 'initial' ||
      (livenessStep === 'liveness_api_passed_processing_final_for_signup_login' && (context === 'login' || context === 'signup') && !isParentProcessing) // Allow retry if parent failed
    ) && modelsLoadedRef.current && !error && !isStartingCamera && !isRecording && !isVerifyingWithAPI && !isProcessingFinalCapture;

  const showRetryButton = livenessStep === 'liveness_failed_or_error' && !isStartingCamera && !isRecording && !isVerifyingWithAPI && !isProcessingFinalCapture;
  
  // Only for admin_update context now
  const showManualFinalCaptureButtonAdmin = (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' || livenessStep === 'final_capture_active') && isCameraActive && !isProcessingFinalCapture && context === 'admin_update';
  
  console.log(`FaceCapture RENDER: context=${context}, livenessStep=${livenessStep}, isCameraActive=${isCameraActive}, isRecording=${isRecording}, isStartingCamera=${isStartingCamera}, error=${error}, isParentProcessing=${isParentProcessing}, showInitialButton=${showInitialButton}`);


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
            ref={detectionCanvasRef} // Still used for admin_update
            className={cn("absolute top-0 left-0 object-cover transform scaleX-[-1]", { 'hidden': !isCameraActive || livenessStep !== 'final_capture_active' || context !== 'admin_update' })}
            style={previewStyle}
        />
        {/* Placeholder when camera is off or starting, and not in a state where video should be visible */}
        {!isCameraActive && 
          ( livenessStep === 'initial' || 
            livenessStep === 'awaiting_models' || 
            livenessStep === 'awaiting_camera_for_video' ||
            (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && context === 'admin_update' && (isStartingCamera || !isCameraActive)) 
          ) && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/80 p-4 text-center">
                {( isStartingCamera || 
                   livenessStep === 'awaiting_models' ||
                   livenessStep === 'awaiting_camera_for_video' || // Includes starting camera for video
                   (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && context === 'admin_update' && (isStartingCamera || !isCameraActive))
                 ) && <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />}
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

      {statusMessage && (livenessStep !== 'initial' || error || ((context === 'login' || context === 'signup') && isParentProcessing) ) && (
        <div className={cn("p-2 rounded-md text-center text-sm w-full",
            {'bg-green-100 text-green-700': 
              (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && context === 'admin_update') || 
              (livenessStep === 'final_capture_active' && context === 'admin_update') ||
              (livenessStep === 'liveness_api_passed_processing_final_for_signup_login' && (context === 'login' || context === 'signup'))
            },
            {'bg-red-100 text-red-700': livenessStep === 'liveness_failed_or_error' || error },
            {'bg-blue-100 text-blue-700': 
              livenessStep !== 'liveness_api_passed_ready_for_manual_final_capture' && 
              livenessStep !== 'liveness_api_passed_processing_final_for_signup_login' &&
              livenessStep !== 'final_capture_active' && 
              livenessStep !== 'liveness_failed_or_error' && !error
            }
        )}>
          {statusMessage}
        </div>
      )}

      {showInitialButton && (
        <Button 
          onClick={handleStartHumanVerification} 
          className="w-full" 
          disabled={
            isStartingCamera || 
            isRecording || 
            isVerifyingWithAPI || 
            isProcessingFinalCapture || // Disable if automatic final capture is happening
            !modelsLoadedRef.current || 
            ((context === 'login' || context === 'signup') && isParentProcessing)
          }
        >
          {(context === 'login' || context === 'signup') && isParentProcessing ? <Loader2 className="mr-2 animate-spin" /> : <UserCheck className="mr-2" />}
          {(context === 'login' || context === 'signup') && isParentProcessing ? `Procesando ${context === 'login' ? 'inicio de sesión' : 'registro'}...` : initialButtonText}
        </Button>
      )}

      {isVerifyingWithAPI && (
        <Button className="w-full" disabled>
            <UploadCloud className="mr-2 animate-pulse" /> Verificando Video...
        </Button>
      )}
      
      {/* Button for admin_update manual capture */}
      {showManualFinalCaptureButtonAdmin && (
        <Button onClick={handleManualFinalCaptureAdmin} className="w-full bg-green-600 hover:bg-green-700" disabled={isProcessingFinalCapture || isStartingCamera || !isCameraActive}>
          <Camera className="mr-2" /> {mainCaptureButtonTextIfLive}
        </Button>
      )}
      {/* Loading indicator for admin_update manual capture processing */}
      {isProcessingFinalCapture && context === 'admin_update' && (
         <Button className="w-full" disabled>
            <Loader2 className="mr-2 animate-spin" /> Procesando Captura Manual...
        </Button>
      )}
      {/* Loading indicator for admin_update when preparing camera for final manual capture */}
      {livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && context === 'admin_update' && (isStartingCamera || !isCameraActive) && !showManualFinalCaptureButtonAdmin && (
         <Button className="w-full" disabled>
            <Loader2 className="mr-2 animate-spin" /> Preparando cámara para captura final...
        </Button>
      )}
      {/* Loading indicator for login/signup when processing final capture automatically */}
      {isProcessingFinalCapture && (context === 'login' || context === 'signup') && !isParentProcessing && (
         <Button className="w-full" disabled>
            <Loader2 className="mr-2 animate-spin" /> Procesando rostro...
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
