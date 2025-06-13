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
  | 'awaiting_camera_for_video' // Camera starting, preparing to record
  | 'recording_video_and_capturing_frame' // Video recording in progress, frame captured
  | 'verifying_video_with_api' // Video sent for liveness check
  | 'liveness_api_passed_ready_for_manual_final_capture' // For admin_update: liveness passed, ready for separate manual still capture
  | 'final_capture_active' // For admin_update: camera active for manual still capture
  | 'processing_final_capture' // For admin_update: processing manually captured still
  | 'liveness_failed_or_error';

const VIDEO_RECORDING_DURATION_MS = 4000; 
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
  
  const capturedFrameDataUrlRef = useRef<string | null>(null);
  const capturedFrameDescriptorRef = useRef<number[] | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isVerifyingWithAPI, setIsVerifyingWithAPI] = useState(false);
  const [isProcessingFinalCaptureAdmin, setIsProcessingFinalCaptureAdmin] = useState(false);

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
    console.log(`FaceCapture: stopCamera llamado desde: ${calledFrom || 'desconocido'}.`);
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop(); 
      console.log("FaceCapture: MediaRecorder detenido activamente desde stopCamera.");
    }
    mediaRecorderRef.current = null;
    
    const videoElement = videoRef.current;
    if (videoElement && videoElement.srcObject) {
      const stream = videoElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoElement.srcObject = null;
      console.log("FaceCapture: Pistas del flujo de medios detenidas y srcObject anulado.");
    }
    
    if (currentStream) {
      setCurrentStream(null); 
    }
    if (isCameraActiveRef.current) { 
      setIsCameraActive(false);
    }
  }, [currentStream]); 

  const loadModels = useCallback(async () => {
    if (modelsLoadedRef.current) {
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

  useEffect(() => { loadModels(); }, [loadModels]);

  const captureFrameAndDescriptor = useCallback(async (): Promise<{ dataUrl: string | null, descriptor: number[] | null }> => {
    if (videoRef.current && captureCanvasRef.current && modelsLoadedRef.current && 
        videoRef.current.readyState >= videoRef.current.HAVE_CURRENT_DATA && 
        videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      const video = videoRef.current;
      const canvas = captureCanvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        try {
          const detection = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
            .withFaceLandmarks().withFaceDescriptor();
          if (detection) {
            console.log("FaceCapture: Descriptor facial calculado para el fotograma del video.");
            return { dataUrl, descriptor: Array.from(detection.descriptor) };
          } else {
            toast({ title: "Captura de Fotograma Fallida", description: "No se detectó un rostro en el fotograma del video.", variant: "destructive" });
            return { dataUrl, descriptor: null }; 
          }
        } catch (e) { 
          console.error("FaceCapture: Error en descriptor de fotograma:", e); 
          toast({ title: "Error de Descriptor de Fotograma", description: "No se pudo procesar el descriptor facial del fotograma.", variant: "destructive" });
          return { dataUrl, descriptor: null };
        }
      }
    }
    console.warn("FaceCapture: No se pudo capturar fotograma, condiciones no cumplidas (video/canvas/modelos/estado del video).");
    toast({ title: "Error de Cámara/Canvas", description: "No se pudo obtener un fotograma del video.", variant: "destructive" });
    return { dataUrl: null, descriptor: null };
  }, [toast]);

  const startRecordingSequence = useCallback(async (stream: MediaStream) => {
    if (isRecordingRef.current) return;
    if (!stream || !stream.active) {
      setError("Error interno: el flujo de la cámara no está activo para la grabación.");
      setLivenessStep('liveness_failed_or_error');
      stopCamera('invalid_stream_in_startRecordingSequence');
      return;
    }

    setIsRecording(true);
    setLivenessStep('recording_video_and_capturing_frame');
    recordedChunksRef.current = []; 
    capturedFrameDataUrlRef.current = null;
    capturedFrameDescriptorRef.current = null;

    if (context === 'login' || context === 'signup') {
        const { dataUrl, descriptor } = await captureFrameAndDescriptor();
        capturedFrameDataUrlRef.current = dataUrl;
        capturedFrameDescriptorRef.current = descriptor;
        if (!dataUrl || !descriptor) {
            console.error("FaceCapture: Fallo crítico al capturar fotograma o descriptor del video stream. Abortando proceso de verificación para login/signup.");
            toast({ title: "Error de Captura Facial", description: "No se pudo procesar tu rostro desde el video. Intenta de nuevo asegurando buena iluminación y rostro visible.", variant: "destructive", duration: 7000});
            onFaceCaptured(null, null, false); // Liveness not even attempted, frame essential
            setLivenessStep('liveness_failed_or_error');
            setIsRecording(false); // Ensure recording state is reset
            stopCamera('frame_capture_failed_before_liveness');
            return; // Stop further execution
        }
    }

    try {
      const options = { mimeType: 'video/webm;codecs=vp8' };
      // @ts-ignore
      if (!MediaRecorder.isTypeSupported(options.mimeType)) delete options.mimeType;
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
        
        setLivenessStep('verifying_video_with_api');
        setIsVerifyingWithAPI(true);

        if (videoBlob.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
          toast({ title: "Video Demasiado Grande", variant: "destructive" });
          onFaceCaptured(null, null, false);
          setLivenessStep('liveness_failed_or_error');
          setIsVerifyingWithAPI(false);
          stopCamera('video_too_large_in_onstop');
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
              // At this point, capturedFrameDataUrlRef and capturedFrameDescriptorRef MUST be valid
              // due to the check at the beginning of startRecordingSequence for these contexts.
              onFaceCaptured(capturedFrameDataUrlRef.current, capturedFrameDescriptorRef.current, true);
            } else if (context === 'admin_update') {
              // Admin update flow still goes to manual capture after liveness
              toast({ title: "Verificación Humana Exitosa", variant: "success" });
              setLivenessStep('liveness_api_passed_ready_for_manual_final_capture');
            }
          } else { 
            toast({ title: "Verificación Humana Fallida", variant: "destructive" });
            onFaceCaptured(null, null, false); 
            setLivenessStep('liveness_failed_or_error');
          }
        } catch (apiError) {
          const apiErrorMsg = apiError instanceof Error ? apiError.message : String(apiError);
          toast({ title: "Error de Verificación", description: apiErrorMsg, variant: "destructive" });
          onFaceCaptured(null, null, false);
          setLivenessStep('liveness_failed_or_error');
        } finally { 
          setIsVerifyingWithAPI(false); 
          // Don't reset livenessStep here if it's liveness_api_passed_ready_for_manual_final_capture (for admin)
          if(context === 'login' || context === 'signup') setLivenessStep('initial');
          stopCamera('liveness_api_call_finished_in_onstop');
        }
      };

      mediaRecorderRef.current.start();
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, VIDEO_RECORDING_DURATION_MS);
    } catch (mediaRecorderError) {
      const mrErrorMsg = mediaRecorderError instanceof Error ? mediaRecorderError.message : String(mediaRecorderError);
      toast({ title: "Error de Grabación", description: mrErrorMsg, variant: "destructive" });
      setIsRecording(false);
      onFaceCaptured(null, null, false); 
      setLivenessStep('liveness_failed_or_error');
      stopCamera('media_recorder_init_error_in_startRecordingSequence');
    }
  }, [context, onFaceCaptured, stopCamera, toast, captureFrameAndDescriptor]);

  const startCamera = useCallback(async (purpose: 'video_liveness' | 'final_capture_admin') => {
    if (isStartingCamera || (currentStream && isCameraActiveRef.current)) return;

    setError(null);
    setIsStartingCamera(true);
    setLivenessStep(purpose === 'video_liveness' ? 'awaiting_camera_for_video' : 'liveness_api_passed_ready_for_manual_final_capture');
    
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
  }, [isStartingCamera, currentStream, toast]);

  useEffect(() => {
    const videoNode = videoRef.current;
    if (!videoNode) return;
    let aborted = false;

    if (currentStream) {
        if (videoNode.srcObject !== currentStream) videoNode.srcObject = currentStream;
        const handleCanPlay = () => {
          if (aborted || !videoNode || videoNode.HAVE_CURRENT_DATA < 2) return; // Ensure video has data
          videoNode.play()
            .then(() => {
              if (aborted) return;
              if (!isCameraActiveRef.current) setIsCameraActive(true);
              if ((context === 'login' || context === 'signup') && livenessStepRef.current === 'awaiting_camera_for_video' && !isRecordingRef.current) {
                startRecordingSequence(currentStream);
              } else if (context === 'admin_update' && livenessStepRef.current === 'liveness_api_passed_ready_for_manual_final_capture') {
                setLivenessStep('final_capture_active');
              }
            })
            .catch(playError => {
              if (aborted) return;
              setError(`Error reproducción: ${playError instanceof Error ? playError.message : String(playError)}`);
              setLivenessStep('liveness_failed_or_error');
              stopCamera('play_error_in_effect_currentStream'); 
            });
        };
        videoNode.addEventListener('canplay', handleCanPlay);
        // If already playable, trigger manually
        if (videoNode.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
             handleCanPlay();
        }
        return () => {
            aborted = true;
            videoNode.removeEventListener('canplay', handleCanPlay);
        };
    } else { 
        if (videoNode.srcObject) {
            const stream = videoNode.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoNode.srcObject = null;
        }
        if (isCameraActiveRef.current) setIsCameraActive(false);
    }
  }, [currentStream, context, startRecordingSequence, stopCamera]);
  
  useEffect(() => {
    let message = "";
    switch(livenessStep) {
      case 'initial':
        message = modelsLoadedRef.current ? "Listo para iniciar verificación." : "Cargando modelos...";
        if (isParentProcessing) message = `Procesando...`;
        break;
      case 'awaiting_models': message = "Cargando modelos..."; break;
      case 'awaiting_camera_for_video': message = error ? error : (isStartingCamera ? "Iniciando cámara..." : "Preparando cámara..."); break;
      case 'recording_video_and_capturing_frame': message = "Grabando video (4s)..."; break;
      case 'verifying_video_with_api': message = "Verificando video..."; break;
      case 'liveness_api_passed_ready_for_manual_final_capture': 
        message = "Verificación OK. Listo para captura manual (admin).";
        break;
      case 'final_capture_active': 
        message = "Cámara lista para captura final (admin)...";
        break;
      case 'processing_final_capture': 
        message = "Procesando captura manual (admin)...";
        break;
      case 'liveness_failed_or_error': message = error || "Verificación fallida."; break;
      default: message = "Procesando...";
    }
    setStatusMessage(message);
  }, [livenessStep, error, isParentProcessing, isStartingCamera]);

  const handleStartHumanVerification = useCallback(async () => {
    if (!modelsLoadedRef.current) {
      toast({ title: "Modelos no cargados", variant: "default" });
      return;
    }
    setError(null); 
    if (livenessStepRef.current !== 'initial') { // Reset states if retrying from an intermediate state
        setIsRecording(false);
        setIsVerifyingWithAPI(false);
        setIsProcessingFinalCaptureAdmin(false);
        capturedFrameDataUrlRef.current = null;
        capturedFrameDescriptorRef.current = null;
    }
    await startCamera('video_liveness');
  }, [startCamera, toast]);
  
  useEffect(() => { 
    if (livenessStepRef.current === 'liveness_api_passed_ready_for_manual_final_capture' && context === 'admin_update') {
      startCamera('final_capture_admin');
    }
  }, [livenessStep, context, startCamera]); 

  useEffect(() => { 
    if (livenessStepRef.current === 'final_capture_active' && isCameraActiveRef.current && modelsLoadedRef.current && !detectionIntervalRef.current && videoRef.current && context === 'admin_update') {
        const video = videoRef.current;
        const canvas = detectionCanvasRef.current;
        if (!canvas) return;
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

  const handleManualFinalCaptureAdmin = useCallback(async () => { 
    if (!videoRef.current || !captureCanvasRef.current || !currentStream || !isCameraActiveRef.current ||
        livenessStepRef.current !== 'final_capture_active' || context !== 'admin_update') {
      toast({ title: "Error de Captura", variant: "destructive" });
      return;
    }
    setIsProcessingFinalCaptureAdmin(true);
    setLivenessStep('processing_final_capture');
    const { dataUrl, descriptor } = await captureFrameAndDescriptor();

    onFaceCaptured(dataUrl, descriptor, true); 
    stopCamera('manual_final_capture_admin_complete');
    setIsProcessingFinalCaptureAdmin(false);
    setLivenessStep('initial'); 
  }, [currentStream, context, onFaceCaptured, stopCamera, toast, captureFrameAndDescriptor]);

  const handleRetry = useCallback(() => {
    stopCamera('retry_button');
    setError(null);
    setIsRecording(false);
    setIsVerifyingWithAPI(false);
    setIsProcessingFinalCaptureAdmin(false);
    capturedFrameDataUrlRef.current = null;
    capturedFrameDescriptorRef.current = null;
    setLivenessStep('initial'); 
    if (!modelsLoadedRef.current) loadModels();
  }, [stopCamera, loadModels]);

  useEffect(() => {
    return () => stopCamera('component_unmount');
  }, [stopCamera]);

  const imageSize = 320;
  const previewStyle = { width: `${imageSize}px`, height: `${imageSize * 0.75}px` };

  const isLoadingState = isStartingCamera || isRecording || isVerifyingWithAPI || livenessStep === 'awaiting_models' || livenessStep === 'awaiting_camera_for_video' ||livenessStep === 'recording_video_and_capturing_frame' || livenessStep === 'verifying_video_with_api';
  const showInitialButton = (livenessStep === 'initial' && modelsLoadedRef.current && !error && !isLoadingState && !isParentProcessing);
  const showRetryButton = livenessStep === 'liveness_failed_or_error' && !isLoadingState && !isParentProcessing;
  const showManualFinalCaptureButtonAdmin = (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' || livenessStep === 'final_capture_active') && isCameraActive && !isProcessingFinalCaptureAdmin && context === 'admin_update' && !isLoadingState;
  
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
            className={cn("absolute top-0 left-0 object-cover transform scaleX-[-1]", { 'hidden': !isCameraActive || livenessStep !== 'final_capture_active' || context !== 'admin_update' })}
            style={previewStyle}
        />
        {!isCameraActive && 
          (livenessStep === 'initial' || livenessStep === 'awaiting_models' || livenessStep === 'awaiting_camera_for_video' || (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && context === 'admin_update' && (isStartingCamera || !isCameraActive)) ) && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/80 p-4 text-center">
                {(isStartingCamera || livenessStep === 'awaiting_models' || livenessStep === 'awaiting_camera_for_video') && 
                  <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                }
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

      {statusMessage && (livenessStep !== 'initial' || error || isParentProcessing ) && (
        <div className={cn("p-2 rounded-md text-center text-sm w-full",
            {'bg-green-100 text-green-700': (livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && context === 'admin_update') || (livenessStep === 'final_capture_active' && context === 'admin_update')},
            {'bg-red-100 text-red-700': livenessStep === 'liveness_failed_or_error' || error },
            {'bg-blue-100 text-blue-700': 
              livenessStep !== 'liveness_api_passed_ready_for_manual_final_capture' && 
              livenessStep !== 'final_capture_active' && 
              livenessStep !== 'liveness_failed_or_error' && !error &&
              (livenessStep === 'awaiting_camera_for_video' || livenessStep === 'recording_video_and_capturing_frame' || livenessStep === 'verifying_video_with_api' || livenessStep === 'awaiting_models')
            }
        )}>
          {statusMessage}
        </div>
      )}

      {showInitialButton && (
        <Button onClick={handleStartHumanVerification} className="w-full" 
          disabled={isParentProcessing || !modelsLoadedRef.current || isLoadingState}>
          {isParentProcessing ? <Loader2 className="mr-2 animate-spin" /> : <UserCheck className="mr-2" />}
          {isParentProcessing ? `Procesando ${context}...` : initialButtonText}
        </Button>
      )}

      {isLoadingState && !isParentProcessing && (
         <Button className="w-full" disabled>
            <Loader2 className="mr-2 animate-spin" /> 
            {statusMessage}
         </Button>
      )}
      
      {showManualFinalCaptureButtonAdmin && (
        <Button onClick={handleManualFinalCaptureAdmin} className="w-full bg-green-600 hover:bg-green-700" 
          disabled={isProcessingFinalCaptureAdmin || isStartingCamera || !isCameraActive || isLoadingState}>
          <Camera className="mr-2" /> {mainCaptureButtonTextIfLive}
        </Button>
      )}
      {isProcessingFinalCaptureAdmin && context === 'admin_update' && (
         <Button className="w-full" disabled>
            <Loader2 className="mr-2 animate-spin" /> Procesando Captura Manual...
        </Button>
      )}
      {livenessStep === 'liveness_api_passed_ready_for_manual_final_capture' && context === 'admin_update' && (isStartingCamera || !isCameraActive) && !showManualFinalCaptureButtonAdmin && (
         <Button className="w-full" disabled>
            <Loader2 className="mr-2 animate-spin" /> Preparando cámara para captura final...
        </Button>
      )}

      {showRetryButton && (
        <Button onClick={handleRetry} className="w-full" variant="outline">
          <RefreshCw className="mr-2"/> Reintentar
        </Button>
      )}
    </div>
  );
};

export default FaceCapture;
