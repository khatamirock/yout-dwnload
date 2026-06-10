/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Download, Youtube, Loader2, AlertCircle, CheckCircle2, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  
  // Settings
  const [type, setType] = useState<'audio' | 'video'>('audio');
  const [videoFormat, setVideoFormat] = useState<'mp4' | 'webm'>('mp4');
  const [videoQuality, setVideoQuality] = useState<'720' | '1080' | 'best'>('1080');
  
  // Logs states
  const [taskId, setTaskId] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Poll for logs when expanding the log screen or when loading
  useEffect(() => {
    if (!taskId) return;
    
    // Auto-open logs if there's an error so user sees the details
    if (status === 'error') setShowLogs(true);
    
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/logs?taskId=${taskId}`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
        }
      } catch (err) {
        // ignore log fetch errors
      }
    };

    // Initial fetch
    fetchLogs();
    
    // Poll every 1.5 seconds if loading or logs are visible
    if (status === 'loading' || showLogs) {
      const interval = setInterval(fetchLogs, 1500);
      return () => clearInterval(interval);
    }
  }, [taskId, status, showLogs]);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

  // Calculate progress from logs
  const latestProgressMatch = [...logs].reverse().find(l => l.match(/\[download\]\s+(\d+\.?\d*)%/));
  const progressPercent = latestProgressMatch ? parseFloat(latestProgressMatch.match(/\[download\]\s+(\d+\.?\d*)%/)?.[1] || '0') : 0;

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    
    const newTaskId = Math.random().toString(36).substring(7);
    setTaskId(newTaskId);
    setLogs([]);
    setStatus('loading');
    setErrorMessage('');

    try {
      let queryParams = `url=${encodeURIComponent(url)}&taskId=${newTaskId}&type=${type}`;
      if (type === 'video') {
        queryParams += `&format=${videoFormat}&quality=${videoQuality}`;
      }

      const response = await fetch(`/api/download?${queryParams}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `Server error: ${response.status}`);
      }

      // the response is an audio file, let's trigger download
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = downloadUrl;
      
      // Get filename from header if possible, else default
      let filename = type === 'audio' ? 'audio.mp3' : `video.${videoFormat}`;
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition && contentDisposition.includes('filename=')) {
        const matches = contentDisposition.match(/filename="?([^"]+)"?/);
        if (matches && matches[1]) {
          filename = matches[1];
        } else {
            // fallback generic parsing
            const splits = contentDisposition.split('filename=');
            if (splits[1]) {
                filename = splits[1].replace(/['"]/g, '');
            }
        }
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);

      setStatus('success');
      setTimeout(() => setStatus('idle'), 3000);
      setUrl('');
    } catch (error: any) {
      console.error(error);
      setStatus('error');
      setErrorMessage(error.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#050507] text-[#e0e0e0] font-sans flex flex-col relative select-none">
      {/* Atmospheric Background Glows */}
      <div className="fixed top-[-20%] left-[-10%] w-[60vw] h-[60vw] bg-indigo-900/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed bottom-[-15%] right-[-5%] w-[50vw] h-[50vw] bg-red-900/10 rounded-full blur-[100px] pointer-events-none"></div>

      {/* Header Navigation */}
      <header className="h-20 flex items-center justify-between px-6 sm:px-12 border-b border-white/5 relative z-10 bg-[#050507]/60 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-600 rounded-lg flex items-center justify-center shadow-lg shadow-red-500/20">
             <Download className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">SonicRip <span className="text-red-500">PRO</span></span>
        </div>
        <div className="flex items-center space-x-4 sm:space-x-6">
          <div className="flex items-center space-x-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="hidden sm:inline text-[10px] uppercase font-bold text-green-400 tracking-wider">yt-dlp active</span>
          </div>
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full">
            <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">ffmpeg v6.0</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center relative z-10 px-4 sm:px-12 py-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-3xl space-y-8 mb-12"
        >
          <div className="text-center space-y-2">
            <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">High-Fidelity Extraction</h1>
            <p className="text-zinc-400">Paste your YouTube link to begin lossless MP3 conversion.</p>
          </div>

          {/* Type Toggle */}
          <div className="flex justify-center space-x-6">
            <button
              type="button"
              onClick={() => setType('audio')}
              className={`text-sm font-bold uppercase tracking-widest pb-1 transition-colors ${
                type === 'audio' ? 'text-red-500 border-b-2 border-red-500' : 'text-zinc-600 hover:text-zinc-400'
              }`}
            >
              Audio
            </button>
            <button
              type="button"
              onClick={() => setType('video')}
              className={`text-sm font-bold uppercase tracking-widest pb-1 transition-colors ${
                type === 'video' ? 'text-red-500 border-b-2 border-red-500' : 'text-zinc-600 hover:text-zinc-400'
              }`}
            >
              Video
            </button>
          </div>

          <form onSubmit={handleDownload} className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-600 to-orange-600 rounded-2xl blur opacity-25 group-focus-within:opacity-50 transition duration-300"></div>
            <div className="relative flex flex-col sm:flex-row items-center bg-[#0d0d10] border border-white/10 rounded-xl p-2 gap-2 sm:gap-0 overflow-hidden">
              {/* Progress Bar Background Glow */}
              {status === 'loading' && progressPercent > 0 && (
                <div 
                  className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-red-500 to-orange-500 transition-all duration-300 ease-out z-0"
                  style={{ width: `${progressPercent}%` }}
                />
              )}
              <input 
                type="url" 
                required
                placeholder="https://www.youtube.com/watch?v=..." 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={status === 'loading'}
                className="w-full sm:flex-1 bg-transparent border-none focus:ring-0 px-4 sm:px-6 py-3 sm:py-0 text-white text-lg placeholder-zinc-600 outline-none disabled:opacity-50"
              />
              <button 
                type="submit"
                disabled={status === 'loading' || !url}
                className="w-full sm:w-auto bg-white text-black px-8 py-3 rounded-lg font-bold hover:bg-zinc-200 transition-colors shadow-xl disabled:opacity-50 disabled:hover:bg-white flex items-center justify-center"
              >
                 <AnimatePresence mode="wait">
                  {status === 'loading' ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2"
                    >
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>{progressPercent > 0 ? `${progressPercent.toFixed(0)}%` : 'Extracting...'}</span>
                    </motion.div>
                  ) : status === 'success' ? (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2 text-green-700"
                    >
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <span>Done</span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      Convert
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </form>

          {/* Conversion Settings */}
          {type === 'audio' ? (
            <div className="flex justify-center items-center space-x-4 sm:space-x-8 text-[10px] sm:text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              <div className="flex items-center space-x-2 text-red-500 bg-red-500/10 px-3 py-1 rounded">
                <span>MP3</span>
              </div>
              <div className="flex items-center space-x-2 opacity-50 cursor-not-allowed">
                <span>WAV</span>
              </div>
              <div className="h-4 w-[1px] bg-white/10"></div>
              <div className="flex items-center space-x-2 text-white px-2 py-0.5 rounded bg-white/10">
                <span>128K</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center items-center gap-4 text-[10px] sm:text-xs font-bold uppercase tracking-[0.2em]">
              {/* Format selection */}
              <div className="flex space-x-2 p-1 bg-white/5 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => setVideoFormat('mp4')}
                  className={`px-3 py-1 rounded transition-colors ${videoFormat === 'mp4' ? 'bg-red-500/20 text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  MP4
                </button>
                <button
                  type="button"
                  onClick={() => setVideoFormat('webm')}
                  className={`px-3 py-1 rounded transition-colors ${videoFormat === 'webm' ? 'bg-red-500/20 text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  WEBM
                </button>
              </div>
              <div className="h-4 w-[1px] bg-white/10"></div>
              {/* Quality selection */}
              <div className="flex space-x-2 p-1 bg-white/5 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => setVideoQuality('720')}
                  className={`px-3 py-1 rounded transition-colors ${videoQuality === '720' ? 'bg-white/20 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  720P
                </button>
                <button
                  type="button"
                  onClick={() => setVideoQuality('1080')}
                  className={`px-3 py-1 rounded transition-colors ${videoQuality === '1080' ? 'bg-white/20 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  1080P
                </button>
                <button
                  type="button"
                  onClick={() => setVideoQuality('best')}
                  className={`px-3 py-1 rounded transition-colors ${videoQuality === 'best' ? 'bg-white/20 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  BEST
                </button>
              </div>
            </div>
          )}
          
          <AnimatePresence>
            {status === 'error' && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm flex gap-3 text-left">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p>{errorMessage}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>
      
      {/* Footer Status Bar */}
      <footer className="h-16 bg-[#08080a] border-t border-white/5 px-6 sm:px-12 flex items-center justify-between z-40 w-full mt-auto relative">
        <div className="flex items-center space-x-4 sm:space-x-8 text-[8px] sm:text-[10px] font-medium tracking-widest text-zinc-500 uppercase">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            <span>API Online</span>
          </div>
          <div className="hidden sm:flex items-center space-x-2">
            <span className="w-1.5 h-1.5 bg-zinc-700 rounded-full"></span>
            <span>Cloud Processing Active</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-6">
          <button 
            type="button"
            onClick={() => setShowLogs(!showLogs)}
            className="group cursor-pointer flex items-center space-x-2 focus:outline-none"
          >
            <span className="text-[10px] font-bold text-zinc-400 group-hover:text-white transition-colors uppercase">
              {showLogs ? 'Hide Logs' : 'Show Logs'}
            </span>
            <Terminal className="w-4 h-4 text-zinc-600 group-hover:text-white transition-colors" />
          </button>
        </div>
      </footer>

      {/* Logs Overlay Panel */}
      <AnimatePresence>
        {showLogs && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-16 left-0 right-0 h-64 sm:h-80 bg-black/95 border-t border-white/10 z-30 flex flex-col backdrop-blur-3xl shadow-[0_-20px_50px_rgba(0,0,0,0.5)]"
          >
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 font-mono text-[10px] sm:text-xs">
              {logs.length === 0 ? (
                <div className="text-zinc-600 flex items-center justify-center h-full">
                  No logs available. Start a task to view processing output.
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, index) => (
                    <div 
                      key={index} 
                      className={`break-words ${
                        log.includes('ERROR') || log.includes('error') ? 'text-red-400' 
                        : log.includes('WARNING') ? 'text-yellow-400' 
                        : 'text-green-400/80'
                      }`}
                    >
                      <span className="opacity-50 select-none mr-2">{'>'}</span>
                      {log}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
