/**
 * Get current Nigerian time (UTC+1)
 * Uses the IANA timezone database for accurate time conversion
 * @returns {Date} Current time in Nigerian timezone
 */
function getNigerianTime() {
  return new Date(new Date().toLocaleString('en-US', {
    timeZone: 'Africa/Lagos'
  }));
}

/**
 * Format the current Nigerian time into a readable string
 * @returns {string} Formatted date string like "Monday, 8 October 2025, 14:30:45"
 */
function formatNigerianTime() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];

  const now = getNigerianTime();
  const day = days[now.getDay()];
  const date = now.getDate();
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  return `${day}, ${date} ${month} ${year}, ${hours}:${minutes}:${seconds}`;
}

/**
 * Get current Lagos time in a specific format
 * @returns {string} Formatted date-time string in en-US format
 */
function getCurrentLagosTime() {
  return new Date().toLocaleString("en-US", {
    timeZone: "Africa/Lagos",
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * Format the current date for database storage
 * @returns {string} Formatted date string in British format (e.g., "15 October 2025")
 */
function formatDateForDB() {
  return new Date().toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

/**
 * Check if a job deadline is still valid
 * @param {string} deadline - The job deadline date string
 * @returns {boolean} True if deadline is valid or not specified
 */
function isJobDeadlineValid(deadline) {
  if (deadline === "Not specified") {
    return true; // Include jobs with no specified deadline
  }
  const jobDate = new Date(deadline);
  const now = new Date();
  return jobDate > now;
}

/**
 * removes APPLY NOW from the string passed as argument
 * @param {string} text - accepts text that may include APPLY NOW
 * @returns {string} trimmed text without APPLY NOW
 */
function removeApplyNowSection(text) {
    const applyNowIndex = text.indexOf("APPLY NOW");

    if (applyNowIndex !== -1) {
      return text.substring(0, applyNowIndex).trim();
    }

    return text;
  }

  /**
   * extracts the date from a string arguement
   * @param {string} text - accepts text that includes date of a job-post was made
   * @returns {string} returns the date
   */
  function extractDateOnly(postedString) {
    return postedString.split("Job posted on ")[1];
  }

module.exports = {
  getNigerianTime,
  formatNigerianTime,
  getCurrentLagosTime,
  formatDateForDB,
  isJobDeadlineValid,
  removeApplyNowSection,
  extractDateOnly
};
