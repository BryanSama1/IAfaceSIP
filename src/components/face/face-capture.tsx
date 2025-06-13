
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
  | 'ready_to_record'
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

  const stopCamera = useCallback((calledFrom?: string) => {
    console.log(`FaceCapture: stopCamera llamado desde: ${calledFrom || 'desconocido'}`);
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    
    const videoElement = videoRef.current;
    if (videoElement && videoElement.srcObject) {
      const stream = videoElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      console.log("FaceCapture: Pistas del flujo de medios detenidas (directo de videoRef).");
      videoElement.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  const loadModels = useCallback(async () => {
    if (modelsLoadedRef.current) {
      setStatusMessage("Modelos faciales ya cargados.");
      if (livenessStep !== 'initial') setLivenessStep('initial');
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
  }, [toast, livenessStep]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const startCamera = useCallback(async (purpose: 'video_liveness' | 'final_capture') => {
    if (isStartingCamera) return;
    if (currentStream && isCameraActive) {
      if (purpose === 'video_liveness' && livenessStep !== 'ready_to_record' && livenessStep !== 'recording_video') {
        if (isCameraActive) setLivenessStep('ready_to_record'); else setLivenessStep('awaiting_camera_for_video');
      } else if (purpose === 'final_capture' && livenessStep !== 'final_capture_active' && (context === 'signup' || context === 'admin_update')) {
        if (isCameraActive) setLivenessStep('final_capture_active'); else setLivenessStep('liveness_api_passed_awaiting_final_camera');
      }
      return;
    }

    setError(null);
    setIsStartingCamera(true);
    setLivenessStep(purpose === 'video_liveness' ? 'awaiting_camera_for_video' : 'liveness_api_passed_awaiting_final_camera');

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      setCurrentStream(mediaStream);
    } catch (err) {
      let message = err instanceof Error ? `${err.name}: ${err.message}` : "Error desconocido de cámara.";
      if (err instanceof Error && err.name === "NotAllowedError") message = "Permiso de cámara denegado.";
      setError(message);
      setLivenessStep('liveness_failed_or_error');
      toast({ title: "Error de Cámara", description: message, variant: "destructive" });
      setCurrentStream(null);
    } finally {
      setIsStartingCamera(false);
    }
  }, [isStartingCamera, currentStream, isCameraActive, context, livenessStep, toast]);

  useEffect(() => {
    const videoNode = videoRef.current;
    if (!videoNode) return;

    if (currentStream) {
      if (videoNode.srcObject !== currentStream) {
        videoNode.srcObject = currentStream;
      }
      const handleCanPlay = () => {
        videoNode.play()
          .then(() => {
            console.log("FaceCapture: Video reproduciéndose.");
            setIsCameraActive(true);
          })
          .catch(playError => {
            const errorMsg = `Error reproducción: ${playError instanceof Error ? playError.message : String(playError)}`;
            console.error("FaceCapture: Error al reproducir video", playError);
            setError(errorMsg);
            setLivenessStep('liveness_failed_or_error');
            setIsCameraActive(false);
            stopCamera('play_error_effect');
          });
      };
      videoNode.addEventListener('canplay', handleCanPlay);
      if (videoNode.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA && !isCameraActive) {
         console.log("FaceCapture: Video tiene suficientes datos y no está activo, intentando reproducir.");
        handleCanPlay();
      }
      return () => videoNode.removeEventListener('canplay', handleCanPlay);
    } else {
      if (videoNode.srcObject) videoNode.srcObject = null;
      setIsCameraActive(false); 
    }
  }, [currentStream, stopCamera, isCameraActive]);

  useEffect(() => {
    if (isCameraActive) {
      if (livenessStep === 'awaiting_camera_for_video') {
        setLivenessStep('ready_to_record');
      } else if (livenessStep === 'liveness_api_passed_awaiting_final_camera' && (context === 'signup' || context === 'admin_update')) {
        setLivenessStep('final_capture_active');
      }
    }
  }, [isCameraActive, livenessStep, context]);
  
  useEffect(() => {
    let message = "";
    switch(livenessStep) {
      case 'initial':
        message = modelsLoadedRef.current ? "Listo para iniciar verificación." : "Cargando modelos...";
        if (context === 'login' && isParentProcessing) message = "Procesando inicio de sesión...";
        break;
      case 'awaiting_models': message = "Cargando modelos de reconocimiento facial..."; break;
      case 'awaiting_camera_for_video': message = error ? error : "Iniciando cámara..."; break;
      case 'ready_to_record': message = "Cámara lista. Preparado para grabar video de verificación."; break;
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
  }, [livenessStep, error, context, isParentProcessing]);


  const handleStartHumanVerification = async () => {
    if (!modelsLoadedRef.current) {
      toast({ title: "Modelos no cargados", description: "Los modelos de reconocimiento facial aún se están cargando.", variant: "default" });
      return;
    }
    setError(null);
    recordedChunksRef.current = [];
    await startCamera('video_liveness');
  };

  useEffect(() => {
    if (livenessStep === 'ready_to_record' && currentStream && videoRef.current && !isRecording && isCameraActive) {
      setIsRecording(true);
      setLivenessStep('recording_video');
      try {
        const options = { mimeType: 'video/webm;codecs=vp8' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.warn(`${options.mimeType} no es soportado, intentando con default.`);
            // @ts-ignore
            delete options.mimeType;
        }
        mediaRecorderRef.current = new MediaRecorder(currentStream, options);
        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) recordedChunksRef.current.push(event.data);
        };

        mediaRecorderRef.current.onstop = async () => {
          setIsRecording(false);
          const videoBlob = new Blob(recordedChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'video/webm' });
          recordedChunksRef.current = [];
          const tempMediaRecorder = mediaRecorderRef.current; 
          mediaRecorderRef.current = null;

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
                    console.log("FaceCapture: Descriptor del cuadro de video (login) calculado.");
                  } else {
                     console.warn("FaceCapture: No se detectó rostro en el cuadro del video para login.");
                  }
                } catch (e) { console.error("FaceCapture: Error en descriptor de cuadro para login:", e); }
              }
            } else {
                console.warn("FaceCapture: El video no estaba listo para capturar el cuadro (login).");
            }
          }

          stopCamera('video_recording_finished');
          setCurrentStream(null); 

          setLivenessStep('verifying_video_with_api');
          setIsVerifyingWithAPI(true);

          if (videoBlob.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
            toast({ title: "Video Demasiado Grande", description: `El video grabado excede los ${MAX_VIDEO_SIZE_MB}MB. Intenta de nuevo.`, variant: "destructive" });
            setError(`Video demasiado grande (${(videoBlob.size / (1024*1024)).toFixed(2)} MB)`);
            if (context === 'login') onFaceCaptured(null, null, false); else setLivenessStep('liveness_failed_or_error');
            setIsVerifyingWithAPI(false);
            return;
          }
          const formData = new FormData();
          formData.append("prompt", "Verifica si la persona en el video es real y viva.");
          formData.append("video_file", videoBlob, `liveness_video.${tempMediaRecorder?.mimeType.split('/')[1].split(';')[0] || 'webm'}`);
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
                // No mostrar toast aquí, LoginForm lo hará.
                // onFaceCaptured se llama con livenessVerificationPassed = true
                onFaceCaptured(loginFrameDataUrl, loginFrameDescriptor, true);
                setLivenessStep('initial'); 
              } else { // signup or admin_update
                toast({ title: "Verificación Humana Exitosa", description: "Persona real detectada. Puedes proceder a la captura final.", duration: 3000 });
                setLivenessStep('liveness_api_passed_ready_for_manual_final_capture');
              }
            } else {
              toast({ title: "Verificación Humana Fallida", description: "No se pudo confirmar que eres una persona real. Intenta de nuevo.", variant: "destructive", duration: 5000 });
              setError("Verificación de vida fallida. Asegura buena iluminación y mira a la cámara.");
              if (context === 'login') onFaceCaptured(null, null, false); else setLivenessStep('liveness_failed_or_error');
            }
          } catch (apiError) {
            const apiErrorMsg = apiError instanceof Error ? apiError.message : String(apiError);
            toast({ title: "Error de Verificación", description: `No se pudo completar la verificación: ${apiErrorMsg}`, variant: "destructive" });
            setError(`Error de comunicación con el servicio de verificación: ${apiErrorMsg}`);
            if (context === 'login') onFaceCaptured(null, null, false); else setLivenessStep('liveness_failed_or_error');
          } finally { setIsVerifyingWithAPI(false); }
        };
        mediaRecorderRef.current.start();
        setTimeout(() => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
        }, VIDEO_RECORDING_DURATION_MS);
      } catch (mediaRecorderError) {
        const mrErrorMsg = mediaRecorderError instanceof Error ? mediaRecorderError.message : String(mediaRecorderError);
        toast({ title: "Error de Grabación", description: `No se pudo iniciar la grabación de video. ${mrErrorMsg}`, variant: "destructive" });
        setIsRecording(false);
        setError(`Error al iniciar la grabación: ${mrErrorMsg}`);
        stopCamera('media_recorder_init_error');
        setCurrentStream(null);
        if (context === 'login') onFaceCaptured(null, null, false); else setLivenessStep('liveness_failed_or_error');
      }
    }
  }, [livenessStep, currentStream, isRecording, stopCamera, toast, context, onFaceCaptured, isCameraActive]);

  useEffect(() => {
    if (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && (context === 'signup' || context === 'admin_update')) {
      startCamera('final_capture');
    }
  }, [livenessStep, context, startCamera]);

  useEffect(() => {
    if (livenessStep === 'final_capture_active' && isCameraActive && modelsLoadedRef.current && !detectionIntervalRef.current && videoRef.current && (context === 'signup' || context === 'admin_update')) {
        const video = videoRef.current;
        const canvas = detectionCanvasRef.current;
        if (!canvas) return;
        console.log("FaceCapture: Iniciando intervalo de detección para captura final manual.");
        detectionIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || video.paused || video.ended || video.readyState < video.HAVE_ENOUGH_DATA) {
                console.log("FaceCapture: Intervalo - Video no listo para detección.");
                return;
            }
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            if (displaySize.width === 0 || displaySize.height === 0) {
                console.log("FaceCapture: Intervalo - Dimensiones de video inválidas para detección.");
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
    } else if ((livenessStep !== 'final_capture_active' || !isCameraActive || context === 'login') && detectionIntervalRef.current) {
        console.log("FaceCapture: Limpiando intervalo de detección.");
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
        if(detectionCanvasRef.current) {
            const context2D = detectionCanvasRef.current.getContext('2d');
            context2D?.clearRect(0, 0, detectionCanvasRef.current.width, detectionCanvasRef.current.height);
        }
    }
    return () => {
        if (detectionIntervalRef.current) {
            console.log("FaceCapture: Limpiando intervalo de detección en cleanup de efecto.");
            clearInterval(detectionIntervalRef.current);
        }
    };
  }, [livenessStep, isCameraActive, context]);

  const handleManualFinalCapture = useCallback(async () => {
    if (!videoRef.current || !captureCanvasRef.current || !currentStream || !isCameraActive ||
        livenessStep !== 'final_capture_active' || !(context === 'signup' || context === 'admin_update')) {
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
    onFaceCaptured(dataUrl, descriptor, true); // Assume liveness passed if we reach manual capture
    stopCamera('manual_final_capture_complete');
    setCurrentStream(null);
    setIsProcessingFinalCapture(false);
    setLivenessStep('initial');
  }, [currentStream, isCameraActive, livenessStep, onFaceCaptured, stopCamera, toast, context]);

  const handleRetry = () => {
    stopCamera('retry_button');
    setCurrentStream(null);
    setError(null);
    setIsRecording(false);
    setIsVerifyingWithAPI(false);
    setIsProcessingFinalCapture(false);
    setLivenessStep('initial');
    if (!modelsLoadedRef.current) loadModels();
  };

  useEffect(() => {
    return () => {
      stopCamera('component_unmount');
    };
  }, [stopCamera]);

  const imageSize = 320;
  const previewStyle = { width: `${imageSize}px`, height: `${imageSize * 0.75}px` };

  const showInitialButton = (livenessStep === 'initial' || (livenessStep === 'liveness_api_passed_awaiting_final_camera' && context === 'login')) && modelsLoadedRef.current && !error;
  const showRetryButton = livenessStep === 'liveness_failed_or_error' && !isStartingCamera && !isRecording && !isVerifyingWithAPI;
  const showManualFinalCaptureButton = (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' || livenessStep === 'final_capture_active') && isCameraActive && !isProcessingFinalCapture && (context === 'signup' || context === 'admin_update');

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
            isStartingCamera || 
            !modelsLoadedRef.current || 
            isVerifyingWithAPI || 
            (context === 'login' && isParentProcessing) 
          }
        >
          {context === 'login' && isParentProcessing ? <Loader2 className="mr-2 animate-spin" /> : <UserCheck className="mr-2" />}
          {context === 'login' && isParentProcessing ? "Procesando inicio de sesión..." : initialButtonText}
        </Button>
      )}

      {livenessStep === 'ready_to_record' && isCameraActive && !isRecording && !isVerifyingWithAPI && (
        <Button className="w-full" disabled={true}>
            <Video className="mr-2" /> Preparado para grabar...
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

    
