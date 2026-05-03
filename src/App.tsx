/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  History, 
  Upload, 
  Settings, 
  Play, 
  Plus, 
  Trash2, 
  Download, 
  CheckCircle, 
  AlertCircle,
  Loader2,
  Layout,
  Image as ImageIcon,
  Key as KeyIcon,
  ChevronRight,
  ExternalLink,
  Info,
  X,
  Zap,
  Square,
  Image,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { PageProfile, PostResult, ApiKey, AppSettings, ImageNode } from './types';

export default function App() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(() => {
    const saved = localStorage.getItem('history_api_keys');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      // Migrate old string[] to ApiKey[] if needed
      return parsed.map((item: any) => 
        typeof item === 'string' ? { key: item, cooldownUntil: null } : item
      );
    } catch { return []; }
  });
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('history_settings');
    if (!saved) return { imageNodes: [], useCustomImageApi: false, githubToken: null, githubRepo: null, githubPath: 'historian_vault.json', autoSync: false };
    try {
      const parsed = JSON.parse(saved);
      if (parsed.customImageApiUrl && (!parsed.imageNodes || parsed.imageNodes.length === 0)) {
        return {
          imageNodes: [{ url: parsed.customImageApiUrl, cooldownUntil: null }],
          useCustomImageApi: parsed.useCustomImageApi,
          githubToken: null,
          githubRepo: null,
          githubPath: 'historian_vault.json',
          autoSync: false
        };
      }
      return {
        ...parsed,
        githubPath: parsed.githubPath || 'historian_vault.json',
        autoSync: parsed.autoSync ?? false
      };
    } catch { 
      return { imageNodes: [], useCustomImageApi: false, githubToken: null, githubRepo: null, githubPath: 'historian_vault.json', autoSync: false }; 
    }
  });

  const syncToGithub = async () => {
    if (!settings.githubToken || !settings.githubRepo) {
      showMessage("GitHub configuration missing.", 'error');
      return;
    }

    try {
      const content = btoa(JSON.stringify({ apiKeys, profiles, results, settings }, null, 2));
      const url = `https://api.github.com/repos/${settings.githubRepo}/contents/${settings.githubPath}`;
      
      // Get SHA if file exists
      const getFile = await fetch(url, {
        headers: { 'Authorization': `token ${settings.githubToken}` }
      });
      
      let sha: string | null = null;
      if (getFile.ok) {
        const data = await getFile.json();
        sha = data.sha;
      }

      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${settings.githubToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: "Historian Engine Auto-Sync",
          content,
          sha: sha || undefined
        })
      });

      if (res.ok) {
        showMessage("Synchronized to GitHub Cloud!", 'success');
      } else {
        throw new Error(await res.text());
      }
    } catch (err: any) {
      console.error(err);
      showMessage("GitHub Sync Failed: " + err.message, 'error');
    }
  };

  const pullFromGithub = async () => {
    if (!settings.githubToken || !settings.githubRepo) {
      showMessage("GitHub configuration missing.", 'error');
      return;
    }

    try {
      const url = `https://api.github.com/repos/${settings.githubRepo}/contents/${settings.githubPath}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `token ${settings.githubToken}` }
      });

      if (!res.ok) throw new Error("File not found in repository.");

      const data = await res.json();
      const vault = JSON.parse(atob(data.content));

      if (vault.apiKeys) setApiKeys(vault.apiKeys);
      if (vault.profiles) setProfiles(vault.profiles);
      if (vault.results) setResults(vault.results);
      if (vault.settings) setSettings(vault.settings);

      showMessage("Vault pulled from GitHub successfully!", 'success');
    } catch (err: any) {
      showMessage("GitHub Pull Failed: " + err.message, 'error');
    }
  };
  const [profiles, setProfiles] = useState<PageProfile[]>(() => {
    const saved = localStorage.getItem('history_profiles');
    return saved ? JSON.parse(saved) : [];
  });
  const [csvData, setCsvData] = useState<{ topic: string }[]>([]);
  const [pickRandom, setPickRandom] = useState(false);
  const [results, setResults] = useState<PostResult[]>(() => {
    const saved = localStorage.getItem('historian_results');
    return saved ? JSON.parse(saved) : [];
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);

  useEffect(() => {
    localStorage.setItem('historian_results', JSON.stringify(results));
  }, [results]);

  // Auto-Sync Effect
  useEffect(() => {
    if (settings.autoSync && settings.githubToken && settings.githubRepo) {
      const timer = setTimeout(() => {
        syncToGithub();
      }, 5000); // Debounce sync by 5s
      return () => clearTimeout(timer);
    }
  }, [results.length, profiles.length, apiKeys.length, settings.autoSync]);
  const [activeTab, setActiveTab] = useState<'generate' | 'profiles' | 'settings'>('generate');
  const [showGuide, setShowGuide] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [exportDirHandle, setExportDirHandle] = useState<any>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'error' | 'success' | 'info' } | null>(null);

  const showMessage = (message: string, type: 'error' | 'success' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 8000);
  };

  // Stable Model Configuration
  const MODELS = {
    STABLE: 'gemini-2.0-flash', // Updated to 2.0 Flash
    IMAGE: 'gemini-1.5-flash'  // 1.5 Flash is currently safest for standard image modality
  };

  const [newKey, setNewKey] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [newLogoUrl, setNewLogoUrl] = useState<string | null>(null);

  const resizeImage = (dataUrl: string, width: number, height: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  };

  // Persistence
  useEffect(() => {
    try {
      localStorage.setItem('history_api_keys', JSON.stringify(apiKeys));
    } catch (e) {
      console.error("Storage error:", e);
    }
  }, [apiKeys]);

  useEffect(() => {
    try {
      localStorage.setItem('history_settings', JSON.stringify(settings));
    } catch (e) {
      console.error("Storage error:", e);
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem('history_profiles', JSON.stringify(profiles));
    } catch (e) {
      alert("Storage Full! Could not save profiles. Try deleting some categories or results.");
      console.error("Storage error:", e);
    }
  }, [profiles]);

  const addApiKey = () => {
    if (newKey) {
      // Split by comma or whitespace and clean
      const keys = newKey.split(/[,\s]+/).map(k => k.trim()).filter(k => k.length > 5);
      const existingKeys = apiKeys.map(ak => ak.key);
      const newEntries: ApiKey[] = keys
        .filter(k => !existingKeys.includes(k))
        .map(k => ({ key: k, cooldownUntil: null }));
      
      if (newEntries.length > 0) {
        setApiKeys([...apiKeys, ...newEntries]);
        setNewKey('');
        showMessage(`Added ${newEntries.length} API keys.`, 'success');
      }
    }
  };

  const importKeysFromTxt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const keys = text.split(/[,\s\n\r]+/).map(k => k.trim()).filter(k => k.length > 5);
        const existingKeys = apiKeys.map(ak => ak.key);
        const newEntries: ApiKey[] = keys
          .filter(k => !existingKeys.includes(k))
          .map(k => ({ key: k, cooldownUntil: null }));
        
        if (newEntries.length > 0) {
          setApiKeys(prev => [...prev, ...newEntries]);
          showMessage(`Imported ${newEntries.length} API keys from file.`, 'success');
        } else {
          showMessage("No new valid keys found in file.", 'info');
        }
      };
      reader.readAsText(file);
    }
  };

  const removeApiKey = (index: number) => {
    setApiKeys(apiKeys.filter((_, i) => i !== index));
  };

  // Rotation & Cooldown Logic
  const getAvailableKey = (): ApiKey | null => {
    const now = Date.now();
    const available = apiKeys.filter(ak => !ak.cooldownUntil || ak.cooldownUntil < now);
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  };

  const getAvailableImageNode = (): ImageNode | null => {
    const now = Date.now();
    const available = settings.imageNodes.filter(node => !node.cooldownUntil || node.cooldownUntil < now);
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  };

  const putOnCooldown = (key: string) => {
    const tenMinutesFromNow = Date.now() + 10 * 60 * 1000;
    setApiKeys(prev => prev.map(ak => 
      ak.key === key ? { ...ak, cooldownUntil: tenMinutesFromNow } : ak
    ));
    console.warn(`Key ${key.slice(0, 6)}... put on cooldown for 10 minutes`);
  };

  const putNodeOnCooldown = (url: string) => {
    const tenMinutesFromNow = Date.now() + 10 * 60 * 1000;
    setSettings(prev => ({
      ...prev,
      imageNodes: prev.imageNodes.map(node => 
        node.url === url ? { ...node, cooldownUntil: tenMinutesFromNow } : node
      )
    }));
    console.warn(`Image node ${url.slice(0, 20)}... put on cooldown`);
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const callGeminiDirect = async (apiKey: string, prompt: string) => {
    const cleanUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.STABLE}:generateContent?key=` + apiKey.trim();
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    
    const res = await fetch(cleanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });
    
    if (res.status === 429) {
      putOnCooldown(apiKey);
      throw new Error("RATE_LIMIT");
    }
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(JSON.stringify(errData) || `Fetch failed with status ${res.status}`);
    }
    
    const data = await res.json();
    return {
      text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      candidates: data.candidates
    };
  };

  const callCustomImageApi = async (prompt: string) => {
    const node = getAvailableImageNode();
    if (!node) throw new Error("No image nodes available or all on cooldown.");
    
    const res = await fetch(node.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    
    if (res.status === 429) {
      putNodeOnCooldown(node.url);
      throw new Error("NODE_RATE_LIMIT");
    }
    
    if (!res.ok) throw new Error(`Custom Image API failed: ${res.status}`);
    
    const data = await res.json();
    if (typeof data === 'string') return data.replace(/^data:image\/\w+;base64,/, '');
    if (data.image) return data.image.replace(/^data:image\/\w+;base64,/, '');
    if (data.url) {
      const imgBlob = await fetch(data.url).then(r => r.blob());
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(imgBlob);
      });
    }
    throw new Error("Invalid response from Custom Image API");
  };

  const generateGeminiImage = async (apiKey: string, prompt: string) => {
    try {
      const contents = [{ role: 'user', parts: [{ text: prompt }] }];
      const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.IMAGE}:generateContent?key=` + apiKey.trim();
      const resRaw = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig })
      });
      
      if (resRaw.status === 429) {
        putOnCooldown(apiKey);
        throw new Error("RATE_LIMIT");
      }
      
      if (!resRaw.ok) throw new Error(`Image fetch failed with status ${resRaw.status}`);
      
      const data = await resRaw.json();
      const candidate = data.candidates?.[0];
      let found = '';
      if (candidate) {
        for (const part of candidate.content.parts) {
          if (part.inlineData) { found = part.inlineData.data; break; }
        }
      }
      if (!found) throw new Error("No image data returned.");
      return found;
    } catch (imgErr: any) {
      if (imgErr.message === 'RATE_LIMIT') throw imgErr;
      console.warn("Gemini Image generation failed, using placeholder:", imgErr);
      return "iVBORw0KGgoAAAANSUhEUgAABDgAAAQ4AQMAAADPSImrAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAABEVJREFUeNrtwTEBAAAAwiD7p7bGDmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAtDImAABFvofEAAAAASUVORK5CYII="; 
    }
  };

  const handleAutoSave = async (composited: string, longText: string, profileName: string) => {
    if (!exportDirHandle) return;
    try {
      const folderName = profileName.replace(/[^a-z0-9]/gi, '_');
      const pageFolderHandle = await exportDirHandle.getDirectoryHandle(folderName, { create: true });
      
      let maxNumber = 0;
      for await (const entry of (pageFolderHandle as any).values()) {
        if (entry.kind === 'file') {
          const num = parseInt(entry.name.split('.')[0]);
          if (!isNaN(num) && num > maxNumber) maxNumber = num;
        }
      }
      const nextNum = maxNumber + 1;

      const imgFile = await pageFolderHandle.getFileHandle(`${nextNum}.jpg`, { create: true });
      const imgW = await imgFile.createWritable();
      const imgResp = await fetch(composited);
      await imgW.write(await imgResp.blob());
      await imgW.close();

      const txtFile = await pageFolderHandle.getFileHandle(`${nextNum}.txt`, { create: true });
      const txtW = await txtFile.createWritable();
      await txtW.write(longText || '');
      await txtW.close();
    } catch (e) {
      console.error("Auto-save error:", e);
    }
  };

  const addProfile = () => {
    if (newProfileName) {
      const profile: PageProfile = {
        id: Math.random().toString(36).substr(2, 9),
        name: newProfileName,
        logoUrl: newLogoUrl
      };
      setProfiles([...profiles, profile]);
      setNewProfileName('');
      setNewLogoUrl(null);
    }
  };

  const removeProfile = (id: string) => {
    setProfiles(profiles.filter(p => p.id !== id));
    if (selectedProfileId === id) setSelectedProfileId('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const extension = file.name.split('.').pop()?.toLowerCase();
      
      if (extension === 'xlsx' || extension === 'xls') {
        const reader = new FileReader();
        reader.onload = (e) => {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const json = XLSX.utils.sheet_to_json(worksheet);
          
          const topics = json
            .map((row: any) => ({ topic: row.Topic || row.topic || row[Object.keys(row)[0]] }))
            .filter(t => t.topic);
          setCsvData(topics);
          showMessage(`Imported ${topics.length} topics from Excel.`, 'success');
        };
        reader.readAsArrayBuffer(file);
      } else {
        // Fallback to CSV
        Papa.parse(file, {
          header: true,
          complete: (results) => {
            const topics = results.data
              .map((row: any) => ({ topic: row.Topic || row.topic || row[Object.keys(row)[0]] }))
              .filter(t => t.topic);
            setCsvData(topics);
            showMessage(`Imported ${topics.length} topics from CSV.`, 'success');
          }
        });
      }
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        // Optimization: Shrink logo to 100x100 to save space in localStorage
        const optimizedLogo = await resizeImage(base64, 100, 100);
        setNewLogoUrl(optimizedLogo);
      };
      reader.readAsDataURL(file);
    }
  };

  const compositeImage = async (base64Img: string, shortText: string, logoUrl: string | null): Promise<string> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1350;
      const ctx = canvas.getContext('2d')!;

      // Background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 1080, 1350);

      const mainImg = new Image();
      mainImg.crossOrigin = "anonymous";
      mainImg.onload = () => {
        // Draw image at top
        ctx.drawImage(mainImg, 0, 0, 1080, 1080);

        // Draw Black overlay for text
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 1140, 1080, 210);

        // Draw Text
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 48px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Wrap text
        const words = shortText.replace(/<yellow>|<\/yellow>/g, '').split(' ');
        const lines: string[] = [];
        let currentLine = '';
        
        words.forEach(word => {
          const testLine = currentLine + word + ' ';
          const metrics = ctx.measureText(testLine);
          if (metrics.width > 980) {
            lines.push(currentLine.trim());
            currentLine = word + ' ';
          } else {
            currentLine = testLine;
          }
        });
        lines.push(currentLine.trim());

        // Draw lines with yellow support
        let currentY = 1140 + (210 / 2) - ((lines.length - 1) * 30);
        
        // Simple logic for the user's yellow tag: find the word in the original text and color it
        const yellowMatch = shortText.match(/<yellow>(.*?)<\/yellow>/);
        const yellowWord = yellowMatch ? yellowMatch[1] : null;

        lines.forEach(line => {
          if (yellowWord && line.includes(yellowWord)) {
            const parts = line.split(yellowWord);
            let startX = 540 - (ctx.measureText(line).width / 2);
            
            ctx.textAlign = 'left';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(parts[0], startX, currentY);
            startX += ctx.measureText(parts[0]).width;
            
            ctx.fillStyle = '#FFD700'; // GOLD/YELLOW
            ctx.fillText(yellowWord, startX, currentY);
            startX += ctx.measureText(yellowWord).width;
            
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(parts[1], startX, currentY);
          } else {
            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(line, 540, currentY);
          }
          currentY += 60;
        });

        // Draw Logo
        if (logoUrl) {
          const logo = new Image();
          logo.onload = () => {
            // "15px deasupra zonei de text" -> text zone starts at 1140. So 1140 - 15 - 100 = 1025
            // "15px fata de latura din dreapta" -> 1080 - 15 - 100 = 965
            ctx.drawImage(logo, 965, 1025, 100, 100);
            resolve(canvas.toDataURL('image/jpeg', 0.9));
          };
          logo.src = logoUrl;
        } else {
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        }
      };
      mainImg.src = `data:image/png;base64,${base64Img}`;
    });
  };

  const processBatch = async () => {
    if (isProcessing) return;
    if (csvData.length === 0) {
      showMessage("Please upload a CSV or XLSX manifest first.", 'error');
      return;
    }
    if (apiKeys.length === 0) {
      showMessage("Please add at least one Gemini API Key in the Vault tab.", 'error');
      return;
    }

    const profilesToProcess = selectedProfileId === 'ALL_PROFILES' 
      ? profiles 
      : profiles.filter(p => p.id === selectedProfileId);

    if (profilesToProcess.length === 0) {
      showMessage("No target Guild selected.", 'error');
      return;
    }

    // Singleton Random Selection - Extract BEFORE processing loop to avoid infinite re-randomization
    let persistentTopics = [...csvData];
    if (pickRandom && csvData.length > 0) {
      const randomIndex = Math.floor(Math.random() * csvData.length);
      persistentTopics = [csvData[randomIndex]];
    }
    
    setIsProcessing(true);
    const newBatchResults: PostResult[] = [];

    // Process only the filtered profiles - ensuring we don't loop over the rest
    for (const profile of profilesToProcess) {
      const profileResults = persistentTopics.map(d => ({
        id: Math.random().toString(36).substr(2, 9),
        topic: d.topic,
        shortText: '',
        longText: '',
        imageUrl: '',
        compositedImageUrl: '',
        pageProfileId: profile.id,
        status: 'pending' as const
      }));
      newBatchResults.push(...profileResults);
    }

    console.log("Lungime array de procesat:", newBatchResults.length);
    if ((selectedProfileId !== 'ALL_PROFILES' && selectedProfileId !== '') && pickRandom && newBatchResults.length > 1) {
      console.error("CRITICAL: Planned tasks > 1 for single selection. Blocking.");
      setIsProcessing(false);
      return;
    }

    setResults(prev => [...newBatchResults, ...prev]);
    setStopRequested(false);

    for (const res of newBatchResults) {
      if (stopRequested) break;
      
      let attempt = 0;
      let success = false;
      
      while (attempt < 3 && !success && !stopRequested) {
        const targetKeyObj = getAvailableKey();
        if (!targetKeyObj) {
          showMessage("All API keys are exhausted. Waiting 60s...", 'error');
          await sleep(60000);
          attempt++;
          continue;
        }

        const targetKey = targetKeyObj.key;

        try {
          const currentProfile = profiles.find(p => p.id === res.pageProfileId);
          if (!currentProfile) break;
          
          setResults(prev => prev.map(r => r.id === res.id ? { ...r, status: 'processing' } : r));
          await sleep(1000);

          const textPrompt = `You are a history content author focused on high-engagement Facebook posts for the page "${currentProfile.name}".
Topic: ${res.topic}

Requirement 1: Short Text (Overlay)
- Max 8 words.
- Punchy, curiosity-driven, or dramatic.
- IMPORTANT: Wrap exactly ONE key historical name or term in <yellow>...</yellow> (e.g., <yellow>Alexander the Great</yellow>).

Requirement 2: Long Description
- ~280 words, exactly 6 paragraphs.
- Hook in the FIRST sentence of the first paragraph.
- Tone: natural, like a real person telling a story to a friend.

Return valid JSON format:
{ "short": "text with <yellow>keyword</yellow>", "long": "text content" }
Return the response as a raw JSON string.`;

          const textResponse = await callGeminiDirect(targetKey, textPrompt);
          const textData = JSON.parse(textResponse.text || '{}');

          let base64Img = '';
          const imagePrompt = `A DSLR 50mm, ultra-realistic, cinematic photorealistic historical scene for: ${res.topic}. Cinematic lighting, museum-quality detail, 4k, historically accurate.`;
          
          if (settings.useCustomImageApi && settings.imageNodes.length > 0) {
            try {
              base64Img = await callCustomImageApi(imagePrompt);
            } catch (err) {
              base64Img = await generateGeminiImage(targetKey, imagePrompt);
            }
          } else {
            base64Img = await generateGeminiImage(targetKey, imagePrompt);
          }

          const composited = await compositeImage(base64Img, textData.short, currentProfile.logoUrl);

          setResults(prev => prev.map(r => r.id === res.id ? { 
            ...r, 
            status: 'done',
            shortText: textData.short,
            longText: textData.long,
            imageUrl: `data:image/png;base64,${base64Img}`,
            compositedImageUrl: composited
          } : r));

          if (exportDirHandle) {
            handleAutoSave(composited, textData.long, currentProfile.name);
          }
          
          success = true;

        } catch (error: any) {
          if (error.message === 'RATE_LIMIT') continue;
          
          setResults(prev => prev.map(r => r.id === res.id ? { 
            ...r, 
            status: 'error',
            error: error.message || "An unexpected error occurred."
          } : r));
          break; 
        }
      }
    }

    setIsProcessing(false);
    if (!stopRequested) {
      showMessage("Automation batch completed for all targets.", 'success');
    } else {
      showMessage("Processing stopped by user.", 'info');
    }
  };

  const resumePending = async () => {
    if (isProcessing) return;
    const toResume = results.filter(r => r.status === 'pending' || r.status === 'error');
    if (toResume.length === 0) {
      showMessage("No pending or error tasks to resume.", 'info');
      return;
    }
    
    setIsProcessing(true);
    setStopRequested(false);

    for (const res of toResume) {
      if (stopRequested) break;
      
      let attempt = 0;
      let success = false;
      
      while (attempt < 3 && !success && !stopRequested) {
        const targetKeyObj = getAvailableKey();
        if (!targetKeyObj) {
          showMessage("All keys exhausted. Waiting...", 'error');
          await sleep(60000);
          attempt++;
          continue;
        }

        const targetKey = targetKeyObj.key;

        try {
          const currentProfile = profiles.find(p => p.id === res.pageProfileId);
          if (!currentProfile) break;
          
          setResults(prev => prev.map(r => r.id === res.id ? { ...r, status: 'processing', error: undefined } : r));
          await sleep(1000);

          // 1. Text
          const textPrompt = `You are a history content author focused on high-engagement Facebook posts for the page "${currentProfile.name}".
Topic: ${res.topic}

Requirement 1: Short Text (Overlay)
- Max 8 words.
- Punchy, curiosity-driven, or dramatic.
- IMPORTANT: Wrap exactly ONE key historical name or term in <yellow>...</yellow> (e.g., <yellow>Alexander the Great</yellow>).

Requirement 2: Long Description
- ~280 words, exactly 6 paragraphs.
- Hook in the FIRST sentence of the first paragraph.
- Tone: natural, like a real person telling a story to a friend.

Return valid JSON format:
{ "short": "text with <yellow>keyword</yellow>", "long": "text content" }
Return the response as a raw JSON string.`;

          const textResponse = await callGeminiDirect(targetKey, textPrompt);
          const textData = JSON.parse(textResponse.text || '{}');

          // 2. Image
          let base64Img = '';
          const imagePrompt = `A DSLR 50mm, ultra-realistic, cinematic photorealistic historical scene for: ${res.topic}. Cinematic lighting, museum-quality detail, 4k, historically accurate.`;
          
          if (settings.useCustomImageApi && settings.imageNodes.length > 0) {
            try {
              base64Img = await callCustomImageApi(imagePrompt);
            } catch (err) {
              base64Img = await generateGeminiImage(targetKey, imagePrompt);
            }
          } else {
            base64Img = await generateGeminiImage(targetKey, imagePrompt);
          }

          const composited = await compositeImage(base64Img, textData.short, currentProfile.logoUrl);

          setResults(prev => prev.map(r => r.id === res.id ? { 
            ...r, 
            status: 'done', 
            shortText: textData.short, 
            longText: textData.long, 
            imageUrl: `data:image/jpeg;base64,${base64Img}`, 
            compositedImageUrl: composited
          } : r));

          if (exportDirHandle) {
            handleAutoSave(composited, textData.long, currentProfile.name);
          }
          
          success = true;
          
        } catch (error: any) {
          if (error.message === 'RATE_LIMIT') continue;
          
          setResults(prev => prev.map(r => r.id === res.id ? { 
            ...r, 
            status: 'error',
            error: error.message || "An unexpected error occurred."
          } : r));
          break;
        }
      }
    }
    setIsProcessing(false);
  };

  const clearResults = () => {
    if (window.confirm("Are you sure you want to clear all generation history?")) {
      setResults([]);
      localStorage.removeItem('historian_results');
      showMessage("Archive cleared.", 'info');
    }
  };

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const connectExportFolder = async () => {
    if (isInIframe) {
      showMessage("SECURITY: Please open the app in a NEW TAB (top-right icon) to enable direct PC Folder access.", 'info');
      return;
    }

    if (!('showDirectoryPicker' in window)) {
      showMessage("Your browser does not support direct folder access. Use Chrome or Edge on desktop.", 'error');
      return;
    }
    
    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      setExportDirHandle(handle);
      showMessage("Vault Connected! Exports will now be written directly to your subfolders.", 'success');
    } catch (e: any) {
      console.error(e);
      if (e.name === 'SecurityError') {
        showMessage("Security Blocked: Please open the app in a new tab to use this feature.", 'error');
      } else if (e.name === 'AbortError') {
        // User cancelled
      } else {
        showMessage("Connection failed. Ensure you are on a compatible desktop browser.", 'error');
      }
    }
  };

  const exportBackup = () => {
    const backup = {
      apiKeys,
      profiles,
      settings,
      results
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historian_vault_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    showMessage("Vault Backup downloaded! Keep this safe for GitHub migration.", 'success');
  };

  const importBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const backup = JSON.parse(event.target?.result as string);
          if (backup.apiKeys) setApiKeys(backup.apiKeys);
          if (backup.profiles) setProfiles(backup.profiles);
          if (backup.settings) setSettings(backup.settings);
          if (backup.results) setResults(backup.results);
          showMessage("Vault synchronized successfully!", 'success');
        } catch (err) {
          showMessage("Failed to parse vault file.", 'error');
        }
      };
      reader.readAsText(file);
    }
  };

  const downloadAll = async () => {
    const doneResults = results.filter(r => r.status === 'done');
    if (doneResults.length === 0) return;

    // Use File System Access API if available and connected
    if (exportDirHandle) {
      for (const res of doneResults) {
        try {
          const profile = profiles.find(p => p.id === res.pageProfileId);
          const folderName = profile ? profile.name.replace(/[^a-z0-9]/gi, '_') : 'Uncategorized';
          
          // 1. Get or create page subfolder
          const pageFolderHandle = await exportDirHandle.getDirectoryHandle(folderName, { create: true });
          
          // 2. Find the highest number already in the folder
          let maxNumber = 0;
          for await (const entry of (pageFolderHandle as any).values()) {
            if (entry.kind === 'file') {
              const nameParts = entry.name.split('.');
              const num = parseInt(nameParts[0]);
              if (!isNaN(num) && num > maxNumber) {
                maxNumber = num;
              }
            }
          }

          const nextNumber = maxNumber + 1;

          // 3. Write Image (Sequential numbering)
          const imgFileHandle = await pageFolderHandle.getFileHandle(`${nextNumber}.jpg`, { create: true });
          const imgWritable = await imgFileHandle.createWritable();
          const response = await fetch(res.compositedImageUrl);
          const blob = await response.blob();
          await imgWritable.write(blob);
          await imgWritable.close();

          // 4. Write Text (Sequential numbering)
          const txtFileHandle = await pageFolderHandle.getFileHandle(`${nextNumber}.txt`, { create: true });
          const txtWritable = await txtFileHandle.createWritable();
          await txtWritable.write(res.longText);
          await txtWritable.close();

        } catch (err) {
          console.error(`Failed to export result sequential for ${res.topic}:`, err);
        }
      }
      showMessage("Export to local folder completed sequentially!", 'success');
      return;
    }

    // Fallback: ZIP download if no local folder connected
    const zip = new JSZip();
    for (const res of doneResults) {
      const profile = profiles.find(p => p.id === res.pageProfileId);
      const folderName = profile ? profile.name.replace(/[^a-z0-9]/gi, '_') : 'Uncategorized';
      const folder = zip.folder(folderName);
      
      if (folder) {
        const baseFileName = res.topic.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
        const imgData = res.compositedImageUrl.split(',')[1];
        folder.file(`${baseFileName}.jpg`, imgData, { base64: true });
        folder.file(`${baseFileName}.txt`, res.longText);
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `History_Archive_${new Date().toISOString().slice(0,10)}.zip`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-bento-bg font-sans text-slate-900 pb-24 md:pb-8">
      {/* Sidebar Nav - Desktop */}
      <nav className="hidden md:flex fixed left-0 top-0 h-full w-24 bg-white border-r border-slate-200 flex-col items-center py-8 gap-10 z-50">
        <div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center text-white shadow-lg">
          <History size={24} />
        </div>
        <div className="flex flex-col gap-8 flex-1">
          <NavIcon label="Build" icon={<Layout size={20}/>} active={activeTab === 'generate'} onClick={() => setActiveTab('generate')} />
          <NavIcon label="Guilds" icon={<ImageIcon size={20}/>} active={activeTab === 'profiles'} onClick={() => setActiveTab('profiles')} />
          <NavIcon label="Vault" icon={<Settings size={20}/>} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </div>
        <button 
          onClick={() => setShowGuide(true)}
          className="text-slate-400 hover:text-black transition-colors"
        >
          <Info size={20} />
        </button>
      </nav>

      {/* Bottom Nav - Mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-around z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <NavIcon label="Build" icon={<Layout size={18}/>} active={activeTab === 'generate'} onClick={() => setActiveTab('generate')} />
        <NavIcon label="Guilds" icon={<ImageIcon size={18}/>} active={activeTab === 'profiles'} onClick={() => setActiveTab('profiles')} />
        <NavIcon label="Vault" icon={<Settings size={18}/>} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        <NavIcon label="Help" icon={<Info size={18}/>} active={false} onClick={() => setShowGuide(true)} />
      </nav>

      {/* Main Content */}
      <main className="md:ml-24 p-4 md:p-8 max-w-7xl mx-auto">
        <header className="mb-6 md:mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm gap-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center shrink-0">
              <div className="w-5 h-5 border-2 border-white rounded-sm rotate-45"></div>
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight italic">Historian Engine</h1>
              <p className="text-[9px] md:text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400">Chronicle Automation v1.0</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:gap-3 w-full sm:w-auto">
            {isInIframe && (
              <button 
                onClick={() => window.open(window.location.href, '_blank')}
                className="px-3 md:px-4 py-2 bg-orange-600 text-white rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-wider shadow-lg hover:bg-orange-700 transition-all flex items-center gap-2 animate-pulse cursor-pointer"
              >
                <ExternalLink size={12} />
                <span className="hidden xs:inline">Open in New Tab</span>
                <span className="xs:hidden">Tab</span>
              </button>
            )}
            <button 
              onClick={connectExportFolder}
              className={`px-3 md:px-4 py-2 border rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-2 transition-all cursor-pointer ${
                exportDirHandle 
                  ? 'bg-green-50 border-green-200 text-green-700' 
                  : isInIframe 
                    ? 'bg-orange-50 border-orange-200 text-orange-700 animate-pulse hover:bg-orange-100' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${exportDirHandle ? 'bg-green-500' : isInIframe ? 'bg-orange-400' : 'bg-slate-300'}`}></div>
              <span className="hidden xs:inline">
                {exportDirHandle 
                  ? 'PC Folder Sync Active' 
                  : isInIframe 
                    ? 'Connect PC Folder (New Tab)' 
                    : 'Connect PC Folder'
                }
              </span>
              <span className="xs:hidden">{exportDirHandle ? 'Synced' : 'PC Connect'}</span>
              {isInIframe && !exportDirHandle && <ExternalLink size={10} />}
            </button>
            <div className="px-3 md:px-4 py-2 bg-white border border-slate-200 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></span>
              {isProcessing ? 'Active' : 'Ready'}
            </div>
            {results.some(r => r.status === 'done') && (
              <button 
                onClick={downloadAll}
                className="px-4 md:px-6 py-2 bg-black text-white rounded-full text-[10px] md:text-xs font-bold shadow-lg hover:shadow-black/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2"
              >
                <Download size={14} />
                <span className="hidden xs:inline">EXPORT BATCH</span>
                <span className="xs:hidden">EXPORT</span>
              </button>
            )}
          </div>
        </header>

        {/* Guide Modal */}
        <AnimatePresence>
          {showGuide && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
              onClick={() => setShowGuide(false)}
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 md:p-10 shadow-2xl relative"
                onClick={e => e.stopPropagation()}
              >
                <button 
                  onClick={() => setShowGuide(false)}
                  className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
                
                <div className="space-y-8">
                  <header>
                    <div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center text-white mb-4">
                      <Info size={24} />
                    </div>
                    <h2 className="text-3xl font-bold italic tracking-tight">How it Works</h2>
                    <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest mt-1">Manual for Chronicle Automation</p>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-black font-bold text-xs">1</div>
                        <h3 className="font-bold text-sm uppercase tracking-wider">Vault Setup</h3>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Go to <strong>Vault</strong> and add your <span className="font-bold text-black underline">Gemini API Keys</span>. You can paste multiple keys separated by commas or upload a .txt file. The app automatically rotates keys and handles rate limits (10min cooldown).
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-black font-bold text-xs">2</div>
                        <h3 className="font-bold text-sm uppercase tracking-wider">Image Source</h3>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Configure your <strong>Image Provider</strong> in Vault. Use Gemini natively or link your custom Cloudflare API for unlimited cinematic generations.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-black font-bold text-xs">3</div>
                        <h3 className="font-bold text-sm uppercase tracking-wider">Build Batch</h3>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        In <strong>Build</strong>, upload a CSV or Excel file with a <code className="bg-slate-100 px-1 rounded italic">Topic</code> column listing historical events or figures.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-black font-bold text-xs">4</div>
                        <h3 className="font-bold text-sm uppercase tracking-wider">AI Generation</h3>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                         Click <strong>Process Batch</strong>. AI generates a cinematic image, a punchy caption, and a 6-paragraph historical narrative.
                      </p>
                    </div>
                  </div>

                  <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
                       <Download size={14} className="text-black" />
                       Pro Tip: Desktop Sync
                    </h4>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Click <strong>Connect PC Folder</strong> (in a new tab) to have the app automatically save images (.jpg) and descriptions (.txt) directly into organized subfolders on your computer.
                    </p>
                  </div>

                  <button 
                    onClick={() => setShowGuide(false)}
                    className="w-full bg-black text-white py-4 rounded-full font-bold shadow-lg hover:scale-[1.02] active:scale-95 transition-all text-sm uppercase tracking-widest"
                  >
                    Start Creating
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {notification && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-6 overflow-hidden"
            >
              <div className={`p-4 rounded-2xl border flex items-center justify-between ${
                notification.type === 'error' ? 'bg-red-50 border-red-100 text-red-700' :
                notification.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
                'bg-slate-900 border-slate-800 text-white'
              }`}>
                <div className="flex items-center gap-3">
                  {notification.type === 'error' ? <AlertCircle size={18} /> : 
                   notification.type === 'success' ? <CheckCircle size={18} /> : 
                   <Info size={18} />}
                  <p className="text-xs font-bold uppercase tracking-wider">{notification.message}</p>
                </div>
                <button onClick={() => setNotification(null)} className="opacity-50 hover:opacity-100 transition-opacity">
                  <X size={16} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {activeTab === 'generate' && (
            <motion.div 
              key="generate"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Controls */}
              <section className="lg:col-span-1 flex flex-col gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-6">Batch Configuration</h2>
                  
                  <div className="space-y-6">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2">Target Profile</label>
                      <select 
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:ring-2 ring-black"
                        value={selectedProfileId}
                        onChange={(e) => setSelectedProfileId(e.target.value)}
                      >
                        <option value="">Select a Page Guild...</option>
                        {profiles.length > 0 && <option value="ALL_PROFILES">⚡ All active Guilds</option>}
                        {profiles.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div 
                      className="border-2 border-dashed border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 bg-slate-50/50 hover:bg-slate-50 hover:border-black/20 transition-all cursor-pointer group"
                      onClick={() => document.getElementById('csv-input')?.click()}
                    >
                      <div className="p-3 bg-white rounded-xl shadow-sm group-hover:scale-110 transition-transform">
                        <Upload className="text-slate-400" size={24} />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-bold">Import Manifest</p>
                        <p className="text-[10px] text-slate-400 font-mono tracking-tighter">CSV or XLSX Files</p>
                      </div>
                      <input id="csv-input" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileUpload} />
                      {csvData.length > 0 && (
                        <div className="mt-2 bg-black text-white text-[10px] font-bold px-3 py-1 rounded-full">
                          {csvData.length} Subjects Identified
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <button 
                        onClick={() => setPickRandom(!pickRandom)}
                        className={`w-12 h-6 rounded-full transition-all relative ${pickRandom ? 'bg-black' : 'bg-slate-200'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${pickRandom ? 'left-7' : 'left-1'}`} />
                      </button>
                      <div>
                        <p className="text-xs font-bold">Pick Random Subject</p>
                        <p className="text-[10px] text-slate-400">Generates only one random topic from file</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button 
                        onClick={processBatch}
                        disabled={csvData.length === 0 || isProcessing || apiKeys.length === 0}
                        className="flex-1 bg-black text-white py-4 rounded-full font-bold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-20 disabled:cursor-not-allowed shadow-lg transition-all"
                      >
                        <Zap size={14} fill="white" />
                        PROCESS BATCH
                      </button>

                      {isProcessing ? (
                        <button 
                          onClick={() => setStopRequested(true)}
                          className="px-6 bg-red-600 text-white rounded-full font-bold text-[10px] uppercase tracking-widest flex items-center justify-center shadow-lg hover:bg-red-700 transition-all cursor-pointer"
                          title="Stop Processing"
                        >
                          <Square size={14} fill="white" />
                        </button>
                      ) : (
                        results.length > 0 && (
                          <div className="flex gap-2">
                            {results.some(r => r.status === 'pending' || r.status === 'error') && (
                              <button 
                                onClick={resumePending}
                                className="px-6 bg-emerald-600 text-white rounded-full font-bold text-[10px] uppercase tracking-widest flex items-center justify-center shadow-lg hover:bg-emerald-700 transition-all cursor-pointer"
                                title="Resume Pending/Errors"
                              >
                                <Play size={14} fill="white" />
                              </button>
                            )}
                            <button 
                              onClick={clearResults}
                              className="px-6 bg-slate-200 text-slate-600 rounded-full font-bold text-[10px] uppercase tracking-widest flex items-center justify-center shadow-sm hover:bg-red-50 hover:text-red-600 transition-all cursor-pointer"
                              title="Clear Results"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )
                      )}
                    </div>
                    
                    {apiKeys.length === 0 && (
                      <p className="text-[10px] text-red-500 font-mono text-center">Missing Gemini API Credentials</p>
                    )}
                  </div>
                </div>

                {results.some(r => r.status === 'done') && (
                  <button 
                    onClick={downloadAll}
                    className="w-full border-2 border-[#141414] py-3 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#141414] hover:text-[#FFD700] transition-all"
                  >
                    <Download size={16} />
                    Export All Chronicles
                  </button>
                )}
              </section>

              {/* Feed */}
              <section className="lg:col-span-2 space-y-6 max-h-[85vh] overflow-y-auto px-1 md:pr-2 scrollbar-hide py-4 pb-32">
                <AnimatePresence>
                  {results.length === 0 ? (
                    <div className="h-64 border border-[#141414]/10 rounded-2xl flex flex-col items-center justify-center opacity-30 grayscale italic">
                      <History size={48} className="mb-4" />
                      Waiting for history to be written...
                    </div>
                  ) : (
                    results.map((res) => {
                      const profile = profiles.find(p => p.id === res.pageProfileId);
                      return (
                        <motion.div 
                          key={res.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2">
                            <div className="p-4 bg-slate-50 flex items-center justify-center border-r border-slate-100 min-h-[300px]">
                              {res.status === 'processing' && (
                                <div className="flex flex-col items-center gap-2">
                                  <Loader2 className="animate-spin text-black" size={24} />
                                  <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Rendering...</p>
                                </div>
                              )}
                              {res.status === 'done' ? (
                                <div className="relative shadow-xl rounded-lg overflow-hidden border border-white max-w-[250px]">
                                  <img src={res.compositedImageUrl} alt={res.topic} className="w-full h-auto object-contain" />
                                </div>
                              ) : res.status !== 'processing' && (
                                <div className="flex flex-col items-center gap-2 opacity-10">
                                  <ImageIcon size={32} />
                                  <p className="text-[9px] font-bold uppercase tracking-widest">Awaiting Viz</p>
                                </div>
                              )}
                            </div>
                            
                            <div className="p-6 flex flex-col gap-4">
                              <header className="flex justify-between items-start border-b border-slate-100 pb-3">
                                <div>
                                  <div className="flex items-center gap-2 mb-1">
                                    {profile?.logoUrl && <img src={profile.logoUrl} className="w-4 h-4 rounded-full" alt="" />}
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{profile?.name}</span>
                                  </div>
                                  <h3 className="text-sm font-bold tracking-tight italic line-clamp-1">{res.topic}</h3>
                                </div>
                                <StatusBadge status={res.status} />
                              </header>

                              {res.status === 'done' && (
                                <div className="space-y-4">
                                  <div className="p-3 bg-slate-900 rounded-xl text-white shadow-sm overflow-hidden">
                                    <h4 className="text-[8px] font-bold uppercase tracking-widest text-white/30 mb-1">Overlay</h4>
                                    <p className="text-[10px] font-medium leading-tight line-clamp-2" dangerouslySetInnerHTML={{ __html: res.shortText.replace(/<yellow>(.*?)<\/yellow>/g, '<span class="text-yellow-400 font-bold">$1</span>') }} />
                                  </div>
                                  <div className="space-y-2">
                                    <h4 className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-1">Social Chronicle</h4>
                                    <div className="text-[10px] leading-relaxed text-slate-600 whitespace-pre-wrap font-sans max-h-[450px] overflow-y-auto pr-2 scrollbar-thin italic hover:scrollbar-visible border-l-2 border-slate-100 pl-3">
                                      {res.longText}
                                    </div>
                                  </div>
                                </div>
                              )}
                              
                              {res.status === 'error' && (
                                <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-start gap-3">
                                  <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="text-[9px] font-bold text-red-600 uppercase tracking-widest">Error</p>
                                    <p className="text-[10px] text-red-500 font-mono leading-tight line-clamp-3">{res.error}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </AnimatePresence>
              </section>
            </motion.div>
          )}

          {activeTab === 'profiles' && (
            <motion.div 
              key="profiles"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-8"
            >
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8">
                <header>
                  <h2 className="text-2xl font-bold tracking-tight italic mb-1">Forge Guild</h2>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400">Initialize a new page profile identity.</p>
                </header>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Guild Alias</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Ancient Architect"
                      className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-4 text-sm focus:ring-2 ring-black"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Identity Sigil (Logo)</label>
                    <div 
                      className="w-32 h-32 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer overflow-hidden relative group transition-all hover:bg-slate-100"
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {newLogoUrl ? (
                        <img src={newLogoUrl} className="w-full h-full object-contain" alt="Logo preview" />
                      ) : (
                        <Upload className="text-slate-300 group-hover:scale-110 transition-transform" />
                      )}
                      <input ref={logoInputRef} type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                    </div>
                  </div>

                  <button 
                    onClick={addProfile}
                    className="w-full bg-black text-white py-4 rounded-full font-bold flex items-center justify-center gap-2 hover:bg-slate-800 shadow-lg active:scale-95 transition-all"
                  >
                    <Plus size={18} />
                    REGISTER GUILD
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 px-2">Active Guilds</h2>
                <div className="grid grid-cols-1 gap-4">
                  {profiles.map(p => (
                    <div key={p.id} className="bg-white p-5 rounded-2xl border border-slate-200 flex items-center gap-5 hover:shadow-lg transition-all group">
                      <div className="w-16 h-16 bg-slate-50 rounded-xl overflow-hidden border border-slate-100">
                        {p.logoUrl && <img src={p.logoUrl} className="w-full h-full object-contain" alt={p.name} />}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-slate-900">{p.name}</h3>
                        <p className="text-[10px] font-mono text-slate-400">UID: {p.id}</p>
                      </div>
                      <button onClick={() => removeProfile(p.id)} className="p-3 opacity-0 group-hover:opacity-100 hover:bg-red-50 text-red-500 rounded-xl transition-all">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                  {profiles.length === 0 && (
                    <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-slate-200 opacity-30 italic font-medium text-slate-400">
                      Empty Archive. Connect a page to begin.
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl space-y-8 pb-10"
            >
              {/* API Keys */}
              <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
                <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight italic mb-1">Vault Access</h2>
                    <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-slate-400">Gemini Credentials & Nodes.</p>
                  </div>
                  <label className="px-4 py-2 border border-slate-200 rounded-full text-[10px] font-bold uppercase tracking-wider hover:bg-slate-50 transition-colors cursor-pointer flex items-center gap-2">
                    <Upload size={14} />
                    Import .TXT
                    <input type="file" accept=".txt" onChange={importKeysFromTxt} className="hidden" />
                  </label>
                </header>

                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input 
                      type="text"
                      placeholder="Enter API keys (comma-separated)..."
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="flex-1 px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
                    />
                    <button 
                      onClick={addApiKey}
                      className="px-8 py-4 bg-black text-white rounded-2xl font-bold text-sm tracking-widest uppercase hover:scale-[1.02] active:scale-95 transition-all w-full sm:w-auto flex items-center justify-center gap-2"
                    >
                      <Plus size={18} />
                      Add
                    </button>
                  </div>

                  <div className="space-y-2">
                    {apiKeys.length === 0 ? (
                      <div className="flex items-center justify-center gap-3 p-12 border-2 border-dashed border-slate-200 rounded-[2rem] opacity-30 grayscale italic text-slate-400">
                        <KeyIcon size={24} />
                        The vault is currently sealed.
                      </div>
                    ) : (
                      apiKeys.map((ak, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl group border border-transparent hover:border-slate-200 transition-all">
                          <div className="flex items-center gap-3">
                            <KeyIcon size={14} className="text-slate-400" />
                            <span className="text-[10px] font-mono font-bold tracking-widest uppercase text-slate-600">
                              {ak.key.substring(0, 6)}••••••••{ak.key.substring(ak.key.length - 4)}
                            </span>
                            {ak.cooldownUntil && ak.cooldownUntil > Date.now() ? (
                              <span className="bg-yellow-100 text-yellow-700 text-[8px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                 <Loader2 size={8} className="animate-spin" />
                                 COOLDOWN
                              </span>
                            ) : (
                              <span className="bg-green-100 text-green-700 text-[8px] font-bold px-2 py-0.5 rounded-full">ACTIVE</span>
                            )}
                          </div>
                          <button 
                            onClick={() => removeApiKey(index)}
                            className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Custom Image Provider */}
              <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg text-black">
                      <ImageIcon size={20} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight italic mb-1">Image Provider</h2>
                      <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-slate-400">Visual Generation Source.</p>
                    </div>
                  </div>
                  <label className="px-4 py-2 border border-slate-200 rounded-full text-[10px] font-bold uppercase tracking-wider hover:bg-slate-50 transition-colors cursor-pointer flex items-center gap-2">
                    <Upload size={14} />
                    Import .TXT
                    <input 
                      type="file" 
                      accept=".txt" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const text = event.target?.result as string;
                            const urls = text.split(/[,\s\n\r]+/).map(u => u.trim()).filter(u => u.startsWith('http'));
                            const existingUrls = settings.imageNodes.map(n => n.url);
                            const newNodes = urls
                              .filter(u => !existingUrls.includes(u))
                              .map(u => ({ url: u, cooldownUntil: null }));
                            setSettings(prev => ({ ...prev, imageNodes: [...prev.imageNodes, ...newNodes] }));
                            showMessage(`Imported ${newNodes.length} image nodes.`, 'success');
                          };
                          reader.readAsText(file);
                        }
                      }} 
                      className="hidden" 
                    />
                  </label>
                </header>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-3">
                      <Zap size={18} className={settings.useCustomImageApi ? "text-yellow-500 fill-yellow-500" : "text-slate-400"} />
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider">Custom Cloudflare API</h4>
                        <p className="text-[10px] text-slate-500">Infinite cinematic generations via worker</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setSettings(prev => ({ ...prev, useCustomImageApi: !prev.useCustomImageApi }))}
                      className={`w-12 h-6 rounded-full transition-all relative ${settings.useCustomImageApi ? 'bg-black' : 'bg-slate-200'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.useCustomImageApi ? 'left-7' : 'left-1'}`}></div>
                    </button>
                  </div>

                  {settings.useCustomImageApi && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-4"
                    >
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input 
                          type="text"
                          placeholder="Node URLs (comma separated)..."
                          className="flex-1 px-5 py-4 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 ring-black/5"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const input = e.currentTarget;
                              const urls = input.value.split(/[,\s]+/).map(u => u.trim()).filter(u => u.startsWith('http'));
                              const existingUrls = settings.imageNodes.map(n => n.url);
                              const newNodes = urls
                                .filter(u => !existingUrls.includes(u))
                                .map(u => ({ url: u, cooldownUntil: null }));
                              if (newNodes.length > 0) {
                                setSettings(prev => ({ ...prev, imageNodes: [...prev.imageNodes, ...newNodes] }));
                                input.value = '';
                                showMessage(`Added ${newNodes.length} nodes.`, 'success');
                              }
                            }
                          }}
                        />
                      </div>

                      <div className="space-y-2">
                        {settings.imageNodes.map((node, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-transparent hover:border-slate-200 transition-all group">
                            <div className="flex items-center gap-3 overflow-hidden">
                              <Square size={12} className="text-slate-400 shrink-0" />
                              <span className="text-[10px] font-mono truncate text-slate-500">{node.url}</span>
                              {node.cooldownUntil && node.cooldownUntil > Date.now() && (
                                <span className="bg-yellow-100 text-yellow-700 text-[8px] font-bold px-2 py-0.5 rounded-full shrink-0">COOLDOWN</span>
                              )}
                            </div>
                            <button 
                              onClick={() => setSettings(prev => ({
                                ...prev,
                                imageNodes: prev.imageNodes.filter((_, idx) => idx !== i)
                              }))}
                              className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <p className="text-[10px] text-slate-400 leading-relaxed italic px-2">
                        Workers rotate randomly. If one hits 429, it goes on 10m cooldown.
                      </p>
                    </motion.div>
                  )}
                </div>
              </div>

              {/* GitHub Cloud Storage */}
              <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                <header className="flex items-center gap-3">
                  <div className="p-2 bg-slate-900 rounded-lg text-white">
                    <History size={20} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight italic mb-1">GitHub Cloud Storage</h2>
                    <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-slate-400">Vault Synchronization & Persistence.</p>
                  </div>
                </header>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-2">Access Token (PAT)</label>
                       <input 
                        type="password"
                        placeholder="ghp_..."
                        value={settings.githubToken || ''}
                        onChange={(e) => setSettings(prev => ({ ...prev, githubToken: e.target.value }))}
                        className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 ring-black/5"
                      />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-2">Repository (User/Repo)</label>
                       <input 
                        type="text"
                        placeholder="username/history-db"
                        value={settings.githubRepo || ''}
                        onChange={(e) => setSettings(prev => ({ ...prev, githubRepo: e.target.value }))}
                        className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 ring-black/5"
                      />
                    </div>
                  </div>
                  
                  <div className="flex gap-3 pt-4">
                    <button 
                      onClick={syncToGithub}
                      className="flex-1 bg-black text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <Download size={16} />
                      Push to Cloud
                    </button>
                    <button 
                      onClick={pullFromGithub}
                      className="flex-1 bg-white border border-slate-200 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <Upload size={16} />
                      Pull from Cloud
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-900 rounded-2xl border border-slate-700">
                    <div className="flex items-center gap-3">
                      <RefreshCw size={18} className={settings.autoSync ? "text-yellow-500 animate-[spin_4s_linear_infinite]" : "text-slate-500"} />
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-white">Live Auto-Sync</h4>
                        <p className="text-[9px] text-slate-400">Push changes automatically to GitHub</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setSettings(prev => ({ ...prev, autoSync: !prev.autoSync }))}
                      className={`w-10 h-5 rounded-full transition-all relative ${settings.autoSync ? 'bg-yellow-500' : 'bg-slate-700'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${settings.autoSync ? 'left-5.5' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center italic">
                    Uses GitHub REST API to store your JSON vault for free.
                  </p>
                </div>
              </div>

              {/* Backups */}
              <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                <h3 className="text-sm font-bold mb-4 uppercase tracking-wider text-slate-900 flex items-center gap-2">
                   <History size={16} />
                   Archive Synchronization
                </h3>
                <p className="text-[10px] text-slate-400 mb-6 leading-relaxed">
                  If your Guilds or Keys are missing in a new tab, use these tools to manually export and import your configuration.
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4">
                  <button 
                    onClick={exportBackup}
                    className="flex-1 bg-white border border-slate-200 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-50 transition-all"
                  >
                    <Download size={14} />
                    Download Vault
                  </button>
                  <button 
                    onClick={() => document.getElementById('backup-input')?.click()}
                    className="flex-1 bg-white border border-slate-200 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-50 transition-all"
                  >
                    <Upload size={14} />
                    Restore Vault
                    <input id="backup-input" type="file" accept=".json" className="hidden" onChange={importBackup} />
                  </button>
                </div>

                <div className="pt-6 border-t border-slate-100 space-y-4">
                   <div className="p-5 bg-slate-900 rounded-[2rem] text-white">
                      <div className="flex items-center gap-2 mb-2 text-yellow-400">
                        <Layout size={14} />
                        <h4 className="text-[10px] font-bold uppercase tracking-widest">GitHub Migration Ready</h4>
                      </div>
                      <p className="text-[10px] opacity-70 leading-relaxed italic">
                        This application is completely portable. To migrate to GitHub: 
                        1. Download your Vault file above. 
                        2. Deploy this app to GitHub Pages. 
                        3. Restore the Vault in your new URL.
                      </p>
                   </div>

                   <button 
                     onClick={() => {
                       if (window.confirm("CRITICAL: This will permanently delete all API Keys, Image Nodes, Profiles, and Results from this browser. Continue?")) {
                         localStorage.clear();
                         window.location.reload();
                       }
                     }}
                     className="w-full py-3 text-[10px] font-bold uppercase tracking-widest text-slate-300 hover:text-red-500 transition-colors"
                   >
                     Purge System Memory
                   </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Guide Modal */}
        <AnimatePresence>
          {showGuide && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto"
              onClick={() => setShowGuide(false)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white w-full max-w-2xl rounded-[3rem] p-8 md:p-12 shadow-2xl relative my-auto"
              >
                <button 
                  onClick={() => setShowGuide(false)}
                  className="absolute top-8 right-8 p-3 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                >
                  <X size={24} />
                </button>

                <header className="mb-10">
                  <h2 className="text-3xl font-bold tracking-tight italic mb-2">Historian Protocol</h2>
                  <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-slate-400">System Documentation & Synchronization.</p>
                </header>

                <div className="space-y-10">
                  <section>
                    <h3 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Zap size={16} className="text-yellow-500" /> Multi-Key Rotation
                    </h3>
                    <p className="text-[11px] leading-relaxed text-slate-500 italic mb-4">
                      The engine supports multiple Gemini API keys and Cloudflare Image Nodes. Keys rotate automatically:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex gap-3">
                        <CheckCircle size={16} className="text-green-500 shrink-0" />
                        <p className="text-[10px] font-medium text-slate-600">429 (Rate Limit) triggers a 10-minute cooldown for that specific key.</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex gap-3">
                        <CheckCircle size={16} className="text-blue-500 shrink-0" />
                        <p className="text-[10px] font-medium text-slate-600">Load Balancing ensures balanced requests across all available vault credentials.</p>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h3 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Layout size={16} /> Asset Synchronization
                    </h3>
                    <div className="space-y-4">
                      <div className="p-6 bg-black text-white rounded-[2.5rem] relative overflow-hidden group">
                          <div className="relative z-10">
                            <h4 className="text-xs font-bold mb-2">Backend & Storage</h4>
                            <p className="text-[10px] opacity-70 leading-relaxed mb-4">
                              All your keys, profiles, and results are stored in Local Storage. For permanent cloud backup, use the <strong>Download Backup</strong> feature.
                            </p>
                            <div className="flex items-center gap-2 text-yellow-400 text-[10px] font-bold">
                              <ExternalLink size={12} />
                              <span>PORTABLE GITHUB DEPLOYMENT READY</span>
                            </div>
                          </div>
                          <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-400/10 rounded-full -mr-16 -mt-16 blur-2xl group-hover:scale-150 transition-transform duration-1000"></div>
                      </div>
                    </div>
                  </section>

                  <section className="pt-8 border-t border-slate-100">
                    <div className="flex justify-between items-center">
                      <div className="text-[9px] font-mono text-slate-400 italic">
                        Firmware: Gemini 2.0 Flash / v2.5.0
                      </div>
                      <button 
                        onClick={() => setShowGuide(false)}
                        className="px-6 py-3 bg-slate-900 text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:scale-105 active:scale-95 transition-all"
                      >
                        Dismiss Protocol
                      </button>
                    </div>
                  </section>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function NavIcon({ icon, active, onClick, label }: { icon: React.ReactNode, active: boolean, onClick: () => void, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-all relative group w-full cursor-pointer`}
    >
      <div className={`p-2.5 md:p-3 rounded-xl transition-all relative z-10 ${active ? 'bg-black text-white' : 'text-slate-400 hover:text-slate-900'}`}>
        {icon}
        {active && <motion.div layoutId="nav-bg" className="absolute inset-0 bg-black rounded-xl -z-10 shadow-lg" />}
      </div>
      <span className={`text-[8px] md:text-[9px] font-bold uppercase tracking-widest transition-colors ${active ? 'text-black' : 'text-slate-400'}`}>
        {label}
      </span>
    </button>
  );
}

function StatusBadge({ status }: { status: PostResult['status'] }) {
  switch (status) {
    case 'done':
      return <div className="bg-slate-900 text-white px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-sm"><div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div> ARCHIVED</div>;
    case 'processing':
      return <div className="bg-slate-50 text-slate-900 px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-slate-200 animate-pulse">FORGING</div>;
    case 'error':
      return <div className="bg-red-50 text-red-700 px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-red-100"><AlertCircle size={10}/> VOID</div>;
    default:
      return <div className="bg-slate-50 text-slate-400 px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-100">PENDING</div>;
  }
}
