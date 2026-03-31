using Photon.Pun;
using Photon.Voice;
using UnityEngine;
using Photon.Voice.Unity;

public class SetMicrophone : MonoBehaviourPun
{
    //detects device microphone and sets it to "Recorder" component from Photon Voice
    private void Start()
    {
        string[] devices = Microphone.devices;
        if (devices.Length > 0)
        {
            var recorder = GetComponent<Recorder>();
            recorder.MicrophoneDevice = new DeviceInfo(devices[0]);

        }
    }
}
