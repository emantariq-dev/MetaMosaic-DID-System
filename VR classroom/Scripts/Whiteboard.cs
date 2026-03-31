using System.Linq;
using UnityEngine;
using Photon.Pun;
using System.Collections.Generic;

namespace ChiliGames.VRClassroom {
    public class Whiteboard : MonoBehaviourPunCallbacks {
        private int maxTextureSize = 2048;
        private int whiteBoardSizeX;
        private int whiteBoardSizeY;
        private Texture2D texture;
        private Color32[] whitePixels;
        new Renderer renderer;

        private Dictionary<int, MarkerData> markerIDs = new Dictionary<int, MarkerData>();

        private float lastX;
        private float lastY;
        private int lastLerpX;
        private int lastLerpY;

        class MarkerData {
            public Color32[] color;
            public bool touchingLastFrame;
            public float[] pos;
            public int pensize;
            public int pensizeD2;
        }

        [SerializeField] List<Renderer> otherWhiteboards;

        bool applyingTexture;

        [HideInInspector] public PhotonView pv;

        void Start() {
            //Dertermine whiteboard resolution from size.
            if (transform.localScale.x > transform.localScale.y)
            {
                float ratio = transform.localScale.x / transform.localScale.y;
                whiteBoardSizeX = maxTextureSize;
                whiteBoardSizeY = (int)(maxTextureSize / ratio);
            }
            else
            {
                float ratio = transform.localScale.y / transform.localScale.x;
                whiteBoardSizeY = maxTextureSize;
                whiteBoardSizeX = (int)(maxTextureSize / ratio);
            }

            renderer = GetComponent<Renderer>();
            texture = new Texture2D(whiteBoardSizeX, whiteBoardSizeY, TextureFormat.RGBA32, false);
            texture.filterMode = FilterMode.Trilinear;
            texture.anisoLevel = 3;
            renderer.material.mainTexture = texture;

            foreach (var item in otherWhiteboards) {
                item.material.mainTexture = texture;
            }

            texture.Apply();

            pv = GetComponent<PhotonView>();

            //Set whiteboard to white
            whitePixels = Enumerable.Repeat(new Color32(255, 255, 255, 255),
                whiteBoardSizeX * whiteBoardSizeY).ToArray();
            ClearWhiteboard();
        }

        //RPC sent by the Marker class so every user gets the information to draw in whiteboard.
        [PunRPC]
        public void DrawAtPosition(int id, float[] _pos) {

            if (markerIDs.ContainsKey(id)) {
                markerIDs[id].pos = _pos;
            } else {
                return;
            }

            int x = (int)(markerIDs[id].pos[0] * whiteBoardSizeX - markerIDs[id].pensizeD2);
            int y = (int)(markerIDs[id].pos[1] * whiteBoardSizeY - markerIDs[id].pensizeD2);

            //If last frame was not touching a marker, we don't need to lerp from last pixel coordinate to new, so we set the last coordinates to the new.
            if (!markerIDs[id].touchingLastFrame) {
                lastX = (float)x;
                lastY = (float)y;
                lastLerpX = x;
                lastLerpY = y;
                markerIDs[id].touchingLastFrame = true;
            }

            if (markerIDs[id].touchingLastFrame) {

                //Lerp last pixel to new pixel, so we draw a continuous line.
                for (float t = 0.01f; t < 1.00f; t += 0.1f) {
                    int lerpX = (int)Mathf.Lerp(lastX, (float)x, t);
                    int lerpY = (int)Mathf.Lerp(lastY, (float)y, t);
                    if (NotTooClose(markerIDs[id].pensizeD2, lerpX, lastLerpX, lerpY, lastLerpY))
                    {
                        texture.SetPixels32(lerpX, lerpY, markerIDs[id].pensize, markerIDs[id].pensize, markerIDs[id].color);
                    }
                }

                if (NotTooClose(markerIDs[id].pensizeD2, x, (int)lastX, y, (int)lastY))
                {
                    texture.SetPixels32(x, y, markerIDs[id].pensize, markerIDs[id].pensize, markerIDs[id].color);
                }
                //so it runs once per frame even if multiple markers are touching the whiteboard
                if (!applyingTexture) {
                    applyingTexture = true;
                    ApplyTexture();
                }
            }

            lastX = (float)x;
            lastY = (float)y;
        }

        private bool NotTooClose(int range, int x1, int x2, int y1, int y2)
        {
            var dx = x1 - x2;
            var dy = y1 - y2;
            return (dx * dx) + (dy * dy) > (range * range);
        }

        public void ApplyTexture() {
            texture.Apply();
            applyingTexture = false;
        }

        [PunRPC]
        public void ResetTouch(int id) {
            if(markerIDs.ContainsKey(id))
                markerIDs[id].touchingLastFrame = false;
        }

        [PunRPC]
        public void RPC_StoreMarkerID(int id, int _pensize, float[] _color)
        {
            if (!markerIDs.ContainsKey(id))
            {
                markerIDs.Add(id, new MarkerData { touchingLastFrame = false, pensize = _pensize, pensizeD2 = _pensize/2}); ;
                markerIDs[id].color = SetColor(new Color(_color[0], _color[1], _color[2]), id);
            }
        }

        //Creates the color array for the marker id
        public Color32[] SetColor(Color32 color, int id) {
            return Enumerable.Repeat(new Color32(color.r, color.g, color.b, 255), markerIDs[id].pensize * markerIDs[id].pensize).ToArray();
        }

        //To clear the whiteboard.
        public void ClearWhiteboard() {
            pv.RPC("RPC_ClearWhiteboard", RpcTarget.AllBuffered);
        }

        [PunRPC]
        public void RPC_ClearWhiteboard() {
            texture.SetPixels32(whitePixels);
            texture.Apply();
        }
    }
}
