import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { rmSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const binDir = join(rootDir, 'bin');
const esPath = join(binDir, 'es.exe');
const GITHUB_API_URL = 'https://api.github.com/repos/voidtools/ES/releases/latest';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

function getArchitecture() {
  try {
    const arch = process.arch;
    if (arch === 'x64' || arch === 'amd64') {
      return 'x64';
    } else if (arch === 'ia32' || arch === 'x86') {
      return 'x86';
    } else if (arch === 'arm64') {
      return 'ARM64';
    }
    return 'x64';
  } catch (err) {
    console.warn('Could not detect architecture, defaulting to x64');
    return 'x64';
  }
}

function ensureBinDirectory() {
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
    console.log('Created bin directory');
  }
}

function downloadWithRetry(url, outputPath, retries = MAX_RETRIES) {
  return new Promise((resolve, reject) => {
    const attempt = (currentRetry) => {
      const file = createWriteStream(outputPath);
      
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          file.close();
          rmSync(outputPath);
          if (response.headers.location) {
            console.log(`Redirecting to: ${response.headers.location}`);
            downloadWithRetry(response.headers.location, outputPath, currentRetry)
              .then(resolve)
              .catch(reject);
            return;
          }
        }
        
        if (response.statusCode !== 200) {
          file.close();
          rmSync(outputPath);
          reject(new Error(`Download failed with status: ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
        
        file.on('error', (err) => {
          file.close();
          rmSync(outputPath);
          reject(err);
        });
      }).on('error', (err) => {
        file.close();
        rmSync(outputPath);
        
        if (currentRetry < retries) {
          console.log(`Download failed, retrying (${currentRetry + 1}/${retries})...`);
          setTimeout(() => attempt(currentRetry + 1), RETRY_DELAY);
        } else {
          reject(err);
        }
      });
    };
    
    attempt(0);
  });
}

async function getLatestRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'everything-search-mcp',
        'Accept': 'application/vnd.github.v3+json',
      },
    };
    
    https.get(GITHUB_API_URL, options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to fetch release info: ${response.statusCode}`));
          return;
        }
        
        try {
          const release = JSON.parse(data);
          resolve(release);
        } catch (err) {
          reject(new Error(`Failed to parse release info: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function findESAsset(assets, architecture) {
  const asset = assets.find(a => 
    a.name.toLowerCase().endsWith(`${architecture.toLowerCase()}.zip`)
  );
  
  return asset;
}

function extractES(zipPath) {
  try {
    console.log('Extracting es.exe from zip file...');
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    const esEntry = zipEntries.find(entry => 
      entry.entryName === 'es.exe' || entry.entryName.endsWith('/es.exe')
    );
    
    if (!esEntry) {
      throw new Error('es.exe not found in zip file');
    }
    
    zip.extractEntryTo(esEntry, binDir, false, true);
    
    if (!existsSync(esPath)) {
      throw new Error('Failed to extract es.exe');
    }
    
    console.log('Successfully extracted es.exe');
    return true;
  } catch (error) {
    throw new Error(`Failed to extract es.exe: ${error.message}`);
  }
}

async function downloadES() {
  try {
    console.log('Checking for es.exe...');
    
    if (existsSync(esPath)) {
      console.log('es.exe already exists, skipping download.');
      return;
    }
    
    const architecture = getArchitecture();
    console.log(`Detected architecture: ${architecture}`);
    
    console.log('Fetching latest ES release from GitHub...');
    const release = await getLatestRelease();
    
    console.log(`Found release: ${release.tag_name || release.name}`);
    
    const asset = await findESAsset(release.assets, architecture);
    
    if (!asset) {
      console.error('Available assets in release:');
      release.assets.forEach(a => console.log(`  - ${a.name}`));
      throw new Error(`No suitable ES zip file found for architecture: ${architecture}`);
    }
    
    console.log(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(2)} MB)...`);
    
    ensureBinDirectory();
    
    const zipPath = join(binDir, asset.name);
    await downloadWithRetry(asset.browser_download_url, zipPath);
    
    console.log('Download complete. Extracting...');
    await extractES(zipPath);
    
    rmSync(zipPath);
    console.log('Cleaned up zip file');
    
    console.log('Successfully downloaded es.exe to:', esPath);
    console.log('You can now use file search functionality.');
  } catch (error) {
    console.error('Failed to download es.exe:', error.message);
    console.error('You can manually download from: https://github.com/voidtools/ES/releases');
    console.error('Then place es.exe in the bin directory.');
    process.exit(1);
  }
}

downloadES();
