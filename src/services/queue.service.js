const config = require("../config/app.config");
const logger = require("../utils/logger.util");

/**
 * Task queue manager to restrict concurrent yt-dlp child processes.
 * Ensures the server is never overloaded by limiting maximum simultaneous spawns.
 */
class QueueService {
  constructor() {
    this.maxConcurrent = config.maxConcurrentProcesses;
    this.activeCount = 0;
    this.queue = [];
  }

  /**
   * Enqueues a task function that returns a Promise.
   * Resolves/rejects with the result of the task function once executed.
   * 
   * @param {Function} taskFn - Async function to execute.
   * @returns {Promise<any>} Result of task function.
   */
  enqueue(taskFn) {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        this.activeCount++;
        logger.info(`Starting task execution. Active tasks: ${this.activeCount}/${this.maxConcurrent}, Pending: ${this.queue.length}`);
        try {
          const result = await taskFn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.activeCount--;
          logger.info(`Task completed. Active tasks: ${this.activeCount}/${this.maxConcurrent}, Pending: ${this.queue.length}`);
          this._processNext();
        }
      };

      if (this.activeCount < this.maxConcurrent) {
        wrappedTask();
      } else {
        logger.info(`Max concurrency reached (${this.maxConcurrent}). Task added to queue. Queue length: ${this.queue.length + 1}`);
        this.queue.push(wrappedTask);
      }
    });
  }

  /**
   * Internal method to process next queued item if available.
   * @private
   */
  _processNext() {
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        nextTask();
      }
    }
  }

  /**
   * Gets current queue status information.
   * @returns {Object} Queue statistics.
   */
  getStats() {
    return {
      activeCount: this.activeCount,
      pendingCount: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }
}

module.exports = new QueueService();
