import EventEmitter from 'events';
import { db } from '../database/db.js';
import { pdfService } from '../services/pdfService.js';
import { googleDriveService } from '../services/googleDriveService.js';

class JobQueueManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map(); // in-memory job status cache
    this.sseClients = new Map(); // jobId -> Set of express res objects
    this.concurrencyLimit = 5;
    this.runningCount = 0;
    this.pendingQueue = [];
    this.useRedis = Boolean(process.env.REDIS_URL);
    this.bullQueue = null;

    this.init();
  }

  async init() {
    if (this.useRedis) {
      try {
        const { Queue, Worker } = await import('bullmq');
        const IORedis = (await import('ioredis')).default;
        const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

        this.bullQueue = new Queue('lesson-plan-uploads', { connection });
        new Worker('lesson-plan-uploads', async (job) => {
          return await this.processJob(job.data);
        }, { connection, concurrency: this.concurrencyLimit });

        console.log('[Queue] Initialized BullMQ with Redis backing.');
        return;
      } catch (err) {
        console.warn('[Queue] Failed to connect to Redis. Falling back to High-Concurrency In-Memory Queue:', err.message);
        this.useRedis = false;
      }
    }

    console.log(`[Queue] Initialized Asynchronous Memory Worker Queue (Concurrency: ${this.concurrencyLimit})`);
  }

  /**
   * Enqueue a submission processing task
   */
  async addJob(data) {
    const { jobId, planId } = data;

    // Persist initial state in DB
    await db.execute(
      `INSERT INTO job_tasks (id, lesson_plan_id, status, progress, message) VALUES (?, ?, ?, ?, ?)`,
      [jobId, planId, 'queued', 10, 'เข้าระบบคิวเรียบร้อย กำลังรอคิวประมวลผล...']
    );

    this.jobs.set(jobId, {
      id: jobId,
      planId,
      status: 'queued',
      progress: 10,
      message: 'เข้าระบบคิวเรียบร้อย กำลังรอคิวประมวลผล...',
      data
    });

    if (this.useRedis && this.bullQueue) {
      await this.bullQueue.add(`job-${jobId}`, data);
    } else {
      this.pendingQueue.push(data);
      this.processNext();
    }

    return { jobId, status: 'queued' };
  }

  processNext() {
    if (this.runningCount >= this.concurrencyLimit || this.pendingQueue.length === 0) {
      return;
    }

    const jobData = this.pendingQueue.shift();
    this.runningCount++;

    this.processJob(jobData)
      .catch((err) => {
        console.error(`[Queue Error] Job ${jobData.jobId} failed:`, err);
      })
      .finally(() => {
        this.runningCount--;
        this.processNext();
      });
  }

  async updateJobProgress(jobId, { status, progress, message, error_message = null }) {
    const job = this.jobs.get(jobId) || {};
    const updated = {
      ...job,
      status,
      progress,
      message,
      error_message,
      updated_at: new Date().toISOString()
    };
    this.jobs.set(jobId, updated);

    // Update in DB
    await db.execute(
      `UPDATE job_tasks SET status = ?, progress = ?, message = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, progress, message, error_message, jobId]
    );

    // Notify SSE clients
    const clients = this.sseClients.get(jobId);
    if (clients && clients.size > 0) {
      const payload = `data: ${JSON.stringify(updated)}\n\n`;
      for (const res of clients) {
        try {
          res.write(payload);
        } catch (e) {
          clients.delete(res);
        }
      }
    }

    this.emit('progress', updated);
  }

  async processJob(jobData) {
    const { jobId, planId, localFilePath, signatureData, teacherName, subjectCode, termName, departmentName } = jobData;

    try {
      // 1. Validating
      await this.updateJobProgress(jobId, {
        status: 'validating',
        progress: 30,
        message: 'กำลังตรวจสอบความถูกต้องของไฟล์ PDF และข้อมูลการส่ง...'
      });
      await new Promise(r => setTimeout(r, 400)); // smooth visual feedback

      // 2. Stamping Signature
      await this.updateJobProgress(jobId, {
        status: 'stamping_signature',
        progress: 60,
        message: 'กำลังประทับตราลายมือชื่ออิเล็กทรอนิกส์และรหัสรับรองลงในเอกสาร PDF...'
      });

      const stampedPdfPath = await pdfService.stampSignature({
        sourcePdfPath: localFilePath,
        signatureBase64: signatureData,
        planId,
        teacherName,
        subjectCode,
        termName,
        signedAt: new Date()
      });

      // 3. Uploading to Google Drive
      await this.updateJobProgress(jobId, {
        status: 'uploading_drive',
        progress: 85,
        message: 'กำลังอัปโหลดไฟล์ที่รับรองแล้วไปยัง Google Drive ของโรงเรียน...'
      });

      const driveFileName = `[${termName}]_${subjectCode}_${teacherName}_แผนการสอน_${planId.substring(0, 6)}.pdf`;
      const driveResult = await googleDriveService.uploadFile({
        filePath: stampedPdfPath,
        fileName: driveFileName,
        planId,
        teacherName,
        departmentName,
        termName
      });

      // 4. Update Lesson Plan Record in Database (Preserve advanced reviewer status if already acted upon)
      await db.execute(
        `UPDATE lesson_plans 
         SET stamped_file_path = ?,
             google_drive_file_id = ?,
             google_drive_view_link = ?,
             google_drive_download_link = ?,
             submission_status = CASE 
               WHEN submission_status IN ('under_review', 'approved', 'revision_needed') THEN submission_status 
               ELSE 'submitted' 
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          stampedPdfPath,
          driveResult.fileId,
          driveResult.webViewLink,
          driveResult.downloadLink,
          planId
        ]
      );

      // 5. Completed
      await this.updateJobProgress(jobId, {
        status: 'completed',
        progress: 100,
        message: 'ส่งแผนการสอนสำเร็จและบันทึกสู่ Google Drive เรียบร้อยแล้ว!'
      });

      console.log(`[Queue] Job ${jobId} finished successfully.`);
      return { success: true, planId, driveResult };

    } catch (err) {
      console.error(`[Queue] Job ${jobId} failed with error:`, err);
      await this.updateJobProgress(jobId, {
        status: 'failed',
        progress: 100,
        message: 'เกิดข้อผิดพลาดในการประมวลผลไฟล์',
        error_message: err.message
      });
      throw err;
    }
  }

  // Register SSE Client for real-time progress
  subscribeSSE(jobId, res) {
    if (!this.sseClients.has(jobId)) {
      this.sseClients.set(jobId, new Set());
    }
    this.sseClients.get(jobId).add(res);

    // Send immediate initial status
    const current = this.jobs.get(jobId);
    if (current) {
      res.write(`data: ${JSON.stringify(current)}\n\n`);
    }

    res.on('close', () => {
      const clients = this.sseClients.get(jobId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          this.sseClients.delete(jobId);
        }
      }
    });
  }

  async getJobStatus(jobId) {
    if (this.jobs.has(jobId)) {
      return this.jobs.get(jobId);
    }
    const row = await db.get(`SELECT * FROM job_tasks WHERE id = ?`, [jobId]);
    return row;
  }
}

export const uploadQueue = new JobQueueManager();
