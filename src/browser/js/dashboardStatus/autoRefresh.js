let handlers = {
  refreshDevices: null,
  refreshFiles: null,
};

export const setDashboardAutoRefreshHandlers = (nextHandlers) => {
  handlers = {
    refreshDevices: nextHandlers && nextHandlers.refreshDevices ? nextHandlers.refreshDevices : null,
    refreshFiles: nextHandlers && nextHandlers.refreshFiles ? nextHandlers.refreshFiles : null,
  };
};

export const clearDashboardAutoRefreshHandlers = () => {
  handlers = {
    refreshDevices: null,
    refreshFiles: null,
  };
};

export const getDashboardAutoRefreshHandlers = () => handlers;
