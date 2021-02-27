const client = () => {
  const config = {
    host: "https://europe-west1-quickstart-1573558070219.cloudfunctions.net",
    baseURL: "https://europe-west1-quickstart-1573558070219.cloudfunctions.net",
    headers: {},
  };
  const instance = axios.create(config);
  batchInterceptor(instance);
  batchInterceptorResponseRouting(instance);
  return instance;
};

const currentExecutingRequests = {};
let paramsForBatchRequest = []; // array to have all non duplicated params
let originalParamsForRequest = []; // array to remember the params for the original requests
let globalBatchResponse = {};
let idRequest = 0; // to be used as an index in originalParamsForRequest
const timeout = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
const batchInterceptor = (instance) => {
  instance.interceptors.request.use(
    (req) => {
      let originalRequest = req;
      // collect distinct params to use for batch request
      req.params.ids.forEach((param) => {
        if (!paramsForBatchRequest.includes(param)) {
          paramsForBatchRequest.push(param);
        }
      });
      // collect original params to do the routing of results later
      originalParamsForRequest.push(req.params.ids);

      // this part is based on https://stackoverflow.com/a/64228288
      if (currentExecutingRequests[req.url]) {
        const source = currentExecutingRequests[req.url];
        delete currentExecutingRequests[req.url];
        // give object to do the routing in the response interceptor
        source.cancel({
          reason: "batch",
          idRequest: idRequest - 1,
        });
      }

      const CancelToken = axios.CancelToken;
      const source = CancelToken.source();
      originalRequest.cancelToken = source.token;
      currentExecutingRequests[req.url] = source;
      originalRequest.params.ids = paramsForBatchRequest;

      idRequest++;

      return originalRequest;
    },
    (error) => {
      Promise.reject(error);
    }
  );
};
const batchInterceptorResponseRouting = (instance) => {
  instance.interceptors.response.use(
    async (response) => {
      globalBatchResponse = Object.assign({}, response);
      responseForOriginalRequest = [];
      globalBatchResponse.data.items.forEach((elem) => {
        // since this response is the last to execute we can
        // use the last entry of originalParamsForRequest
        if (originalParamsForRequest[idRequest - 1].includes(elem.id)) {
          responseForOriginalRequest.push(elem);
        }
      });
      if (responseForOriginalRequest.length === 0) {
        // if not catch it will trigger Uncaught (in promise) No results
        return Promise.reject("No results");
        // can use this one to fail silently
        // return new Promise(() => {});
      }
      return {
        data: {
          items: responseForOriginalRequest,
        },
      };
    },
    async (error) => {
      if (axios.isCancel(error) && error.message.reason === "batch") {
        await timeout(2000);
        responseForOriginalRequest = [];
        globalBatchResponse.data.items.forEach((elem) => {
          if (
            originalParamsForRequest[error.message.idRequest].includes(elem.id)
          ) {
            responseForOriginalRequest.push(elem);
          }
        });

        if (responseForOriginalRequest.length === 0) {
          // if not catch it will trigger Uncaught (in promise) No results
          return Promise.reject("No results");
          // can use this one to fail silently
          // return new Promise(() => {});
        }
        return Promise.resolve({
          data: {
            items: responseForOriginalRequest,
          },
        });
      }
      return Promise.reject(error);
    }
  );
};

function runTest() {
  const batchUrl = "/file-batch-api";
  const apiClient = client();
  // Should return [{id:"fileid1"},{id:"fileid2"}]
  apiClient.get(batchUrl, {
    params: {
      ids: ["fileid1", "fileid2"],
    },
  });
  // Should return [{id:"fileid2"}]
  apiClient.get(batchUrl, {
    params: {
      ids: ["fileid2"],
    },
  });
  // Should reject as the fileid3 is missing from the response
  apiClient.get(batchUrl, {
    params: {
      ids: ["fileid3"],
    },
  });
  // Should return [{id:"fileid1"},{id:"fileid2"},{id:"fileid4"}]
  apiClient.get(batchUrl, {
    params: {
      ids: ["fileid1", "fileid2", "fileid3", "fileid4"],
    },
  });
  // Should return [{id:"fileid2"}]
  apiClient.get(batchUrl, {
    params: {
      ids: ["fileid2"],
    },
  });
}

runTest();
