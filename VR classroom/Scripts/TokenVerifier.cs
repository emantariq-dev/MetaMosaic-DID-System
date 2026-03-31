using System;
using System.Text;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
using TMPro;

[Serializable]
public class VerifyResponse
{
    public bool ok;
    public string sub;    // wallet address
    public bool reused;   // optional if backend is idempotent
    public string error;  // optional
}

public class TokenVerifier : MonoBehaviour
{
    [Header("Backend")]
    public string backendUrl = "http://localhost:4000";
    public string verifyPath = "/session/verify";
    public string nextSceneName = "Lobby"; // set the scene name you want to load

    [Header("UI")]
    public TMP_InputField tokenInput;
    public TextMeshProUGUI statusText;
    public Button verifyButton;
    public GameObject spinner; // optional

    [Header("Timeout")]
    public float requestTimeoutSeconds = 15f;

    bool _inFlight = false;

    void Awake()
    {
        Application.runInBackground = true;
        if (spinner) spinner.SetActive(false);
        if (statusText) statusText.text = "Paste token (or pass via --token=...)";
        if (verifyButton) verifyButton.onClick.AddListener(OnVerifyClicked);
    }

    void OnDestroy()
    {
        if (verifyButton) verifyButton.onClick.RemoveListener(OnVerifyClicked);
    }

    void OnVerifyClicked()
    {
        if (_inFlight) return;
        string jwt = tokenInput != null ? tokenInput.text.Trim() : "";
        if (string.IsNullOrEmpty(jwt))
        {
            SetStatus("Please paste a token.", true);
            return;
        }
        StartCoroutine(Verify(jwt));
    }

    IEnumerator Verify(string jwt)
    {
        _inFlight = true;
        SetBusy(true, "Verifying…");

        var url = backendUrl.TrimEnd('/') + verifyPath;
        var json = "{\"token\":\"" + Escape(jwt) + "\"}";
        var body = Encoding.UTF8.GetBytes(json);

        using (var req = new UnityWebRequest(url, "POST"))
        {
            req.uploadHandler = new UploadHandlerRaw(body);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.timeout = Mathf.CeilToInt(requestTimeoutSeconds);

            yield return req.SendWebRequest();

#if UNITY_2020_2_OR_NEWER
            bool netErr = req.result == UnityWebRequest.Result.ConnectionError || req.result == UnityWebRequest.Result.ProtocolError;
#else
            bool netErr = req.isNetworkError || req.isHttpError;
#endif
            long code = req.responseCode;
            string text = req.downloadHandler != null ? req.downloadHandler.text : "";

            if (netErr)
            {
                if (code == 409)
                {
                    // token reuse (single-use JTI)
                    SetStatus("Token already used. Please issue a new token.", true);
                }
                else if (code == 401)
                {
                    // expired/invalid
                    SetStatus("Token expired/invalid. Issue a new token.", true);
                }
                else
                {
                    SetStatus($"Network error: HTTP {code}\n{text}", true);
                }
                SetBusy(false);
                _inFlight = false;
                yield break;
            }

            VerifyResponse vr = null;
            try { vr = JsonUtility.FromJson<VerifyResponse>(text); }
            catch (Exception ex)
            {
                SetStatus($"Bad response: {ex.Message}", true);
                SetBusy(false);
                _inFlight = false;
                yield break;
            }

            if (vr != null && vr.ok)
            {
                SetStatus("Verified. Loading…", false);
                yield return new WaitForEndOfFrame();
                SceneManager.LoadScene(nextSceneName);
                yield break;
            }
            else
            {
                string msg = "Verification failed.";
                if (vr != null && !string.IsNullOrEmpty(vr.error)) msg += $" {vr.error}";
                SetStatus(msg, true);
                SetBusy(false);
                _inFlight = false;
            }
        }
    }

    void SetBusy(bool busy, string msg = null)
    {
        if (verifyButton) verifyButton.interactable = !busy;
        if (spinner) spinner.SetActive(busy);
        if (!string.IsNullOrEmpty(msg)) SetStatus(msg, false);
    }

    void SetStatus(string msg, bool isError)
    {
        if (!statusText) return;
        statusText.text = msg ?? "";
        statusText.color = isError ? new Color(0.85f, 0.1f, 0.1f) : new Color(0.82f, 0.82f, 0.82f);
    }

    static string Escape(string s) =>
        s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
