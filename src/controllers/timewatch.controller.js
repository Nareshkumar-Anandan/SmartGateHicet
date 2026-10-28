const timewatchApiService = require('../services/timewatchApiService');
const timewatchSyncService = require('../services/timewatchSyncService');
const { logAudit } = require('../middleware/auditLogger');

async function getConfig(req, res, next) {
  try {
    const config = timewatchApiService.getConfig();
    return res.json({ success: true, config });
  } catch (error) {
    next(error);
  }
}

async function updateConfig(req, res, next) {
  try {
    const { apiUrl, apiKey, timeoutMs } = req.body;
    const updated = timewatchApiService.updateConfig({ apiUrl, apiKey, timeoutMs });

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'TIMEWATCH_CONFIG_UPDATED',
      entityType: 'DEVICE',
      entityId: 0,
      details: `Updated TimeWatch API configuration to ${updated.apiUrl}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: 'TimeWatch API configuration updated.',
      config: updated
    });
  } catch (error) {
    next(error);
  }
}

async function testConnection(req, res, next) {
  try {
    const result = await timewatchApiService.testConnection();
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getDeviceList(req, res, next) {
  try {
    const { SerialNumber } = req.body || {};
    const result = await timewatchApiService.getDeviceList(SerialNumber);
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function syncTime(req, res, next) {
  try {
    const { DeviceList } = req.body;
    if (!DeviceList || !Array.isArray(DeviceList) || DeviceList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'DeviceList must be a non-empty array of device serial numbers.'
      });
    }

    const result = await timewatchApiService.syncTime(DeviceList);

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'TIMEWATCH_SYNC_TIME',
      entityType: 'DEVICE',
      entityId: 0,
      details: `Synced server time to devices: ${DeviceList.join(', ')}`,
      ipAddress: req.ip
    });

    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function pullLogs(req, res, next) {
  try {
    const { DeviceList, FromDate, ToDate } = req.body;
    if (!DeviceList || !Array.isArray(DeviceList) || DeviceList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'DeviceList must be a non-empty array of device serial numbers.'
      });
    }

    const result = await timewatchApiService.pullLogs({ DeviceList, FromDate, ToDate });

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'TIMEWATCH_PULL_LOGS',
      entityType: 'DEVICE',
      entityId: 0,
      details: `Commanded pull logs for devices: ${DeviceList.join(', ')} (${FromDate} to ${ToDate})`,
      ipAddress: req.ip
    });

    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getPunchData(req, res, next) {
  try {
    const { FromDate, ToDate, DeviceID, UserID } = req.body;
    if (!FromDate || !ToDate) {
      return res.status(400).json({
        success: false,
        message: 'FromDate and ToDate are required (YYYY-MM-DD).'
      });
    }

    const result = await timewatchApiService.getPunchData({ FromDate, ToDate, DeviceID, UserID });
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function syncPunches(req, res, next) {
  try {
    const { FromDate, ToDate, DeviceID, UserID, dryRun = false } = req.body;
    if (!FromDate || !ToDate) {
      return res.status(400).json({
        success: false,
        message: 'FromDate and ToDate are required (YYYY-MM-DD).'
      });
    }

    const result = await timewatchSyncService.syncPunchData({
      FromDate,
      ToDate,
      DeviceID,
      UserID,
      dryRun: Boolean(dryRun)
    });

    if (result.success && !dryRun) {
      await logAudit({
        userId: req.user?.id,
        actorName: req.user?.full_name || 'System',
        actorRole: req.user?.role || 'SUPER_ADMIN',
        action: 'TIMEWATCH_PUNCH_SYNC',
        entityType: 'DEVICE',
        entityId: 0,
        details: `Ingested ${result.summary.processed} punches from TimeWatch API (Granted: ${result.summary.granted}, Denied: ${result.summary.denied}, Duplicates: ${result.summary.duplicates})`,
        ipAddress: req.ip
      });
    }

    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getUserDetail(req, res, next) {
  try {
    const { UserID, DeviceID } = req.body;
    if (!UserID && !DeviceID) {
      return res.status(400).json({
        success: false,
        message: 'At least one of UserID or DeviceID must be provided.'
      });
    }

    const result = await timewatchApiService.getUserDetail({ UserID, DeviceID });
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function addUser(req, res, next) {
  try {
    const { UserID, Name, DeviceID, AccesstimeFrom, AccesstimeTo, Card, FaceTemplate } = req.body;
    if (!UserID || !Name || !DeviceID) {
      return res.status(400).json({
        success: false,
        message: 'UserID, Name, and DeviceID are mandatory.'
      });
    }

    const result = await timewatchApiService.addUser({
      UserID,
      Name,
      DeviceID,
      AccesstimeFrom,
      AccesstimeTo,
      Card,
      FaceTemplate
    });

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'TIMEWATCH_ADD_USER',
      entityType: 'STUDENT',
      entityId: 0,
      details: `Added/updated biometric user ${Name} (${UserID}) on TimeWatch terminal ${DeviceID}`,
      ipAddress: req.ip
    });

    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function deleteUser(req, res, next) {
  try {
    const { UserID, DeviceID } = req.body;
    if (!UserID || !DeviceID) {
      return res.status(400).json({
        success: false,
        message: 'Both UserID and DeviceID are mandatory.'
      });
    }

    const result = await timewatchApiService.deleteUser({ UserID, DeviceID });

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'TIMEWATCH_DELETE_USER',
      entityType: 'STUDENT',
      entityId: 0,
      details: `Deleted biometric user ${UserID} from TimeWatch terminal ${DeviceID}`,
      ipAddress: req.ip
    });

    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getUserImage(req, res, next) {
  try {
    const { DeviceID, UserID } = req.body;
    if (!DeviceID || !UserID) {
      return res.status(400).json({
        success: false,
        message: 'Both DeviceID and UserID are mandatory.'
      });
    }

    const result = await timewatchApiService.getUserImage({ DeviceID, UserID });
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function remoteEnrollment(req, res, next) {
  try {
    const { DeviceID, UserID, Type = 'FACE' } = req.body;
    if (!DeviceID || !UserID) {
      return res.status(400).json({
        success: false,
        message: 'Both DeviceID and UserID are mandatory.'
      });
    }

    const result = await timewatchApiService.remoteEnrollment({ DeviceID, UserID, Type });

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'TIMEWATCH_REMOTE_ENROLL',
      entityType: 'STUDENT',
      entityId: 0,
      details: `Triggered remote ${Type} enrollment on terminal ${DeviceID} for User ${UserID}`,
      ipAddress: req.ip
    });

    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getCommands(req, res, next) {
  try {
    const { Executed = 'false', TransferToDevice } = req.body;
    const result = await timewatchApiService.getCommands({ Executed, TransferToDevice });
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

// ==========================================
// TimeWatch iDMS Server (172.25.3.51:9001)
// ==========================================
const timewatchIdmsService = require('../services/timewatchIdmsService');

async function getServerStatus(req, res, next) {
  try {
    const status = await timewatchIdmsService.testConnection();
    const serviceStatus = timewatchIdmsService.getStatus();
    return res.json({
      success: true,
      ...status,
      serviceStatus
    });
  } catch (error) {
    next(error);
  }
}

async function syncIdmsDevices(req, res, next) {
  try {
    const result = await timewatchIdmsService.syncDevicesToDb();
    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'TIMEWATCH_SYNC_DEVICES',
      entityType: 'DEVICE',
      entityId: 0,
      details: `Synced ${result.totalSynced} physical turnstile devices from TimeWatch server (172.25.3.51:9001)`,
      ipAddress: req.ip
    });
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function syncIdmsUsers(req, res, next) {
  try {
    const result = await timewatchIdmsService.syncUsersToDb();
    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'TIMEWATCH_SYNC_USERS',
      entityType: 'STUDENT',
      entityId: 0,
      details: `Imported ${result.totalImported} enrolled biometric users from TimeWatch server`,
      ipAddress: req.ip
    });
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

async function syncIdmsPunches(req, res, next) {
  try {
    const result = await timewatchIdmsService.pollAndProcessPunches();
    return res.json({
      success: true,
      ...result,
      stats: timewatchIdmsService.getStatus().stats
    });
  } catch (error) {
    next(error);
  }
}

async function toggleLiveSync(req, res, next) {
  try {
    const { enable = true, intervalMs = 3000 } = req.body;
    if (enable) {
      timewatchIdmsService.startLiveSync(intervalMs);
    } else {
      timewatchIdmsService.stopLiveSync();
    }
    return res.json({
      success: true,
      message: enable ? `Live punch sync started (interval: ${intervalMs}ms)` : 'Live punch sync stopped.',
      status: timewatchIdmsService.getStatus()
    });
  } catch (error) {
    next(error);
  }
}

async function getIdmsPunches(req, res, next) {
  try {
    const punches = await timewatchIdmsService.getRealTimePunches();
    return res.json({
      success: true,
      count: punches.length,
      punches
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getConfig,
  updateConfig,
  testConnection,
  getDeviceList,
  syncTime,
  pullLogs,
  getPunchData,
  syncPunches,
  getUserDetail,
  addUser,
  deleteUser,
  getUserImage,
  remoteEnrollment,
  getCommands,
  // iDMS Server
  getServerStatus,
  syncIdmsDevices,
  syncIdmsUsers,
  syncIdmsPunches,
  toggleLiveSync,
  getIdmsPunches
};

