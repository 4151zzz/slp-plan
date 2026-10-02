import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export class GoogleDriveService {
  constructor() {
    this.drive = null;
    this.isConfigured = false;
    this.serviceAccountEmail = null;
    this._folderId = null;
    this.folderCache = new Map(); // key: `${parentId}:${folderName}` -> folderId
    this.init();
  }

  get folderId() {
    return process.env.GOOGLE_DRIVE_FOLDER_ID || this._folderId || null;
  }

  set folderId(val) {
    this._folderId = val;
  }

  init() {
    try {
      const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
      const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

      let credentials = null;

      if (keyJson) {
        credentials = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
      } else {
        const defaultPath = path.resolve(process.cwd(), 'credentials/service-account.json');
        const targetPath = keyPath ? (path.isAbsolute(keyPath) ? keyPath : path.resolve(process.cwd(), keyPath)) : defaultPath;
        if (fs.existsSync(targetPath)) {
          credentials = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        }
      }

      if (credentials) {
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive']
        });
        this.drive = google.drive({ version: 'v3', auth });
        this.isConfigured = true;
        this.serviceAccountEmail = credentials.client_email;
        console.log('[Google Drive] Authenticated successfully with Service Account:', credentials.client_email);
      } else {
        console.log('[Google Drive] No Service Account credentials found. Running in Simulation/Dev Mode.');
      }
    } catch (error) {
      console.warn('[Google Drive] Initialization error (falling back to Mock Mode):', error.message);
      this.isConfigured = false;
    }
  }

  /**
   * Find an existing folder or create one dynamically under parentFolderId
   * @param {string} folderName - Name of the folder to find/create
   * @param {string|null} parentFolderId - Parent folder ID (default: root folderId)
   * @returns {Promise<string>} - Google Drive folder ID
   */
  async getOrCreateFolder(folderName, parentFolderId = this.folderId) {
    const cleanName = (folderName || 'General').trim();
    const parentId = parentFolderId || 'root';
    const cacheKey = `${parentId}:${cleanName}`;

    if (this.folderCache.has(cacheKey)) {
      return this.folderCache.get(cacheKey);
    }

    // In Simulation/Dev Mock Mode
    if (!this.isConfigured || !this.drive) {
      const mockFolderId = `mock_fld_${Buffer.from(cleanName).toString('hex').substring(0, 10)}`;
      this.folderCache.set(cacheKey, mockFolderId);
      console.log(`[Google Drive Sim] Folder assigned: "${cleanName}" -> ID: ${mockFolderId} (Parent: ${parentId})`);
      return mockFolderId;
    }

    try {
      // 1. Search for existing folder in Google Drive
      let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${cleanName.replace(/'/g, "\\'")}' and trashed = false`;
      if (parentFolderId) {
        query += ` and '${parentFolderId}' in parents`;
      }

      const searchRes = await this.drive.files.list({
        q: query,
        fields: 'files(id, name, webViewLink)',
        spaces: 'drive',
        pageSize: 1
      });

      if (searchRes.data.files && searchRes.data.files.length > 0) {
        const foundFolder = searchRes.data.files[0];
        this.folderCache.set(cacheKey, foundFolder.id);
        console.log(`[Google Drive] Reusing existing folder: "${cleanName}" (${foundFolder.id})`);
        return foundFolder.id;
      }

      // 2. Folder does not exist, create it
      console.log(`[Google Drive] Creating new folder: "${cleanName}" under parent: ${parentId}...`);
      const fileMetadata = {
        name: cleanName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentFolderId ? [parentFolderId] : undefined
      };

      const createRes = await this.drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, webViewLink'
      });

      const newFolderId = createRes.data.id;
      this.folderCache.set(cacheKey, newFolderId);

      // Grant folder reader permission if needed
      try {
        await this.drive.permissions.create({
          fileId: newFolderId,
          requestBody: { role: 'reader', type: 'anyone' }
        });
      } catch (permErr) {
        // Ignored if domain restricted
      }

      console.log(`[Google Drive] Created folder: "${cleanName}" successfully (${newFolderId})`);
      return newFolderId;

    } catch (err) {
      console.error(`[Google Drive] Error getting/creating folder "${cleanName}":`, err.message);
      // Fallback to parent or root folder
      return parentFolderId || null;
    }
  }

  /**
   * Get or create department folder under root folder
   * @param {string} departmentName 
   */
  async getOrCreateDepartmentFolder(departmentName) {
    const dept = (departmentName || 'กลุ่มสาระทั่วไป').trim();
    return await this.getOrCreateFolder(dept, this.folderId);
  }

  /**
   * Get or create teacher folder under department folder
   * Hierarchy: Root Folder -> Department Folder -> Teacher Folder
   * @param {string} departmentName 
   * @param {string} teacherName 
   */
  async getOrCreateTeacherFolder(departmentName, teacherName) {
    const deptFolderId = await this.getOrCreateDepartmentFolder(departmentName);
    const teacher = (teacherName || 'ครูผู้สอน').trim();
    return await this.getOrCreateFolder(teacher, deptFolderId);
  }

  /**
   * Upload PDF to Google Drive in the teacher's individual folder
   * @param {Object} param0 
   * @param {string} param0.filePath - Local path to stamped PDF
   * @param {string} param0.fileName - Name to save in Drive
   * @param {string} param0.planId - Lesson plan ID
   * @param {string} param0.teacherName - Teacher name for folder & metadata
   * @param {string} param0.departmentName - Department name for folder hierarchy
   * @param {string} param0.termName - Academic term name
   */
  async uploadFile({ filePath, fileName, planId, teacherName, departmentName, termName }) {
    // Resolve target folder dynamically (Department -> Teacher)
    let targetFolderId = this.folderId;
    if (departmentName && teacherName) {
      try {
        targetFolderId = await this.getOrCreateTeacherFolder(departmentName, teacherName);
      } catch (fldErr) {
        console.warn('[Google Drive] Could not resolve teacher folder, using root folder:', fldErr.message);
      }
    } else if (departmentName) {
      try {
        targetFolderId = await this.getOrCreateDepartmentFolder(departmentName);
      } catch (fldErr) {
        console.warn('[Google Drive] Could not resolve department folder, using root folder:', fldErr.message);
      }
    }

    if (this.isConfigured && this.drive) {
      try {
        console.log(`[Google Drive] Uploading ${fileName} into target folder (${targetFolderId})...`);
        const fileMetadata = {
          name: fileName,
          description: `แผนการสอนครู ${teacherName} (${departmentName || '-'}) [Plan ID: ${planId}]`,
          parents: targetFolderId ? [targetFolderId] : undefined
        };

        const media = {
          mimeType: 'application/pdf',
          body: fs.createReadStream(filePath)
        };

        const response = await this.drive.files.create({
          requestBody: fileMetadata,
          media: media,
          fields: 'id, name, webViewLink, webContentLink, size, parents'
        });

        // Grant read permission to anyone with link if needed
        try {
          await this.drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
              role: 'reader',
              type: 'anyone'
            }
          });
        } catch (permErr) {
          console.warn('[Google Drive] Note on permissions:', permErr.message);
        }

        console.log(`[Google Drive] Upload success: File ID ${response.data.id} in folder ${targetFolderId}`);
        return {
          fileId: response.data.id,
          webViewLink: response.data.webViewLink,
          downloadLink: response.data.webContentLink,
          folderId: targetFolderId,
          isMock: false
        };
      } catch (error) {
        console.error('[Google Drive] Real upload failed, falling back to simulated drive link:', error.message);
      }
    }

    // High-Fidelity Mock Mode for Zero-Setup Local Testing
    const mockFileId = `gdrive_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const mockViewLink = `https://drive.google.com/file/d/${mockFileId}/view?usp=sharing`;
    const mockDownloadLink = `/api/files/download/${planId}`;

    console.log(`[Google Drive Sim] Upload simulated for: ${fileName}`);
    console.log(`[Google Drive Sim] Placed in Folder ID: ${targetFolderId}`);

    return {
      fileId: mockFileId,
      webViewLink: mockViewLink,
      downloadLink: mockDownloadLink,
      folderId: targetFolderId,
      isMock: true
    };
  }

  /**
   * Batch sync or pre-create folder structure for all departments and teachers
   * @param {Array} departments - List of departments
   * @param {Array} users - List of users / teachers
   */
  async syncAllFolders(departments = [], users = []) {
    const results = {
      totalDepartments: departments.length,
      totalTeachers: 0,
      departmentsCreated: 0,
      teachersCreated: 0,
      tree: []
    };

    const teachers = users.filter(u => u.role === 'teacher' || u.role === 'dept_head');
    results.totalTeachers = teachers.length;

    for (const dept of departments) {
      const deptName = dept.name;
      const deptFolderId = await this.getOrCreateDepartmentFolder(deptName);
      results.departmentsCreated++;

      const deptTeachers = teachers.filter(t => t.department === deptName);
      const teacherList = [];

      for (const t of deptTeachers) {
        const teacherFolderId = await this.getOrCreateFolder(t.name, deptFolderId);
        results.teachersCreated++;
        teacherList.push({
          name: t.name,
          email: t.email,
          folderId: teacherFolderId,
          link: this.isConfigured ? `https://drive.google.com/drive/folders/${teacherFolderId}` : null
        });
      }

      results.tree.push({
        department: deptName,
        folderId: deptFolderId,
        link: this.isConfigured ? `https://drive.google.com/drive/folders/${deptFolderId}` : null,
        teachers: teacherList
      });
    }

    return results;
  }

  /**
   * Get Google Drive connection status and root folder info
   */
  async checkConnectionStatus() {
    const status = {
      isConfigured: this.isConfigured,
      serviceAccountEmail: this.serviceAccountEmail,
      rootFolderId: this.folderId,
      mode: this.isConfigured ? 'live' : 'simulation',
      rootFolderName: null,
      error: null
    };

    if (this.isConfigured && this.drive && this.folderId) {
      try {
        const folder = await this.drive.files.get({
          fileId: this.folderId,
          fields: 'id, name, webViewLink'
        });
        status.rootFolderName = folder.data.name;
        status.webViewLink = folder.data.webViewLink;
      } catch (err) {
        status.error = `เข้าถึงโฟลเดอร์หลัก (${this.folderId}) ไม่สำเร็จ: ${err.message}`;
      }
    }

    return status;
  }
}

export const googleDriveService = new GoogleDriveService();
