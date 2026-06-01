import { useParams } from "react-router-dom";
import VideoCall from "../VideoCall";
import AudioCall from "../AudioCall";

const Call = () => {
    const { type, roomId } = useParams()

    if (!roomId) {
        return null;
    }

    return (
        <>
            {
                type === "audio" ?
                    <AudioCall roomId={roomId} />
                    : type === "video" ?
                        <VideoCall roomId={roomId} />
                        : ""
            }
        </>
    )
}

export default Call
