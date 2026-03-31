using System;
using UnityEngine;
using UnityEngine.XR.Interaction.Toolkit;
using Photon.Pun;
using UnityEngine.XR.Interaction.Toolkit.Interactors;
using UnityEngine.XR.Interaction.Toolkit.Interactables;

public class XRGrabbablePunOffset : XRGrabInteractable
{
    private Vector3 interactorPosition = Vector3.zero;
    private Quaternion interactorRotation = Quaternion.identity;
    private XRBaseInteractor grabInteractor;

    PhotonView pv;
    bool wasKinematic;

    protected override void Awake()
    {
        base.Awake();
        pv = GetComponent<PhotonView>();
        wasKinematic = GetComponent<Rigidbody>().isKinematic;
    }

    [Obsolete("Obsolete")]
    protected override void OnSelectEntered(SelectEnterEventArgs args)
    {
        base.OnSelectEntered(args);
        // If it is a socket, don't offset
        if (args.interactor is XRSocketInteractor) return;

        StoreInteractor(args.interactor);
        MatchAttachmentPoints(args.interactor);
        pv.TransferOwnership(PhotonNetwork.LocalPlayer.ActorNumber);
        pv.RPC("SetKinematic", RpcTarget.OthersBuffered, true);
    }

    private void StoreInteractor(XRBaseInteractor interactor)
    {
        interactorPosition = interactor.attachTransform.localPosition;
        interactorRotation = interactor.attachTransform.localRotation;
        grabInteractor = interactor;
    }

    private void MatchAttachmentPoints(XRBaseInteractor interactor)
    {
        bool hasAttach = attachTransform != null;
        interactor.attachTransform.position = hasAttach ? attachTransform.position : transform.position;
        interactor.attachTransform.rotation = hasAttach ? attachTransform.rotation : transform.rotation;
    }

    [Obsolete("Obsolete")]
    protected override void OnSelectExited(SelectExitEventArgs args)
    {
        base.OnSelectExited(args);
        if (args.interactor is XRSocketInteractor) return;

        ResetAttachmentPoint(args.interactor);
        ClearInteractor(args.interactor);
        pv.RPC("SetKinematic", RpcTarget.OthersBuffered, wasKinematic);
    }

    private void ResetAttachmentPoint(XRBaseInteractor interactor)
    {
        interactor.attachTransform.localPosition = interactorPosition;
        interactor.attachTransform.localRotation = interactorRotation;
    }

    private void ClearInteractor(XRBaseInteractor interactor)
    {
        interactorPosition = Vector3.zero;
        interactorRotation = Quaternion.identity;
        grabInteractor = null;
    }

    private void OnCollisionEnter(Collision collision)
    {
        if (grabInteractor != null)
        {
            var controller = grabInteractor.GetComponent<XRBaseInputInteractor>();
            if (controller != null)
            {
                controller.SendHapticImpulse(collision.relativeVelocity.magnitude / 10f, 0.1f);
            }
        }
    }

    [PunRPC]
    public void SetKinematic(bool state)
    {
        GetComponent<Rigidbody>().isKinematic = state;
    }
}
