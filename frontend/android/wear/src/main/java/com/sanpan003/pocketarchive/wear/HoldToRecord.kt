package com.sanpan003.pocketarchive.wear

import android.content.Context
import android.os.PowerManager
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Starting a recording from the watch's tile or complication needs a deliberate gesture (2.13.2): a tap only opens
 * this screen, and the recording starts when the big button has been HELD for half a second. Nothing is pressed → it
 * closes by itself after 8 s and nothing is recorded. (The hardware key is a deliberate press by itself.)
 */
const val HOLD_MS = 500
private const val GIVE_UP_MS = 8_000L

@Composable
fun HoldToRecord(from: String, onConfirmed: () -> Unit, onCancel: () -> Unit) {
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { delay(GIVE_UP_MS); onCancel() }
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(104.dp).pointerInput(Unit) {
                    detectTapGestures(onPress = {
                        val job = scope.launch {
                            progress.snapTo(0f)
                            progress.animateTo(1f, tween(HOLD_MS, easing = LinearEasing))
                            onConfirmed()
                        }
                        tryAwaitRelease()
                        job.cancel()
                        scope.launch { progress.snapTo(0f) }
                    })
                },
                contentAlignment = Alignment.Center,
            ) {
                Canvas(Modifier.size(104.dp)) {
                    drawCircle(Color(0xFF3B1D0B))
                    drawArc(Color(0xFFF59E0B), -90f, 360f * progress.value, false, Offset(6f, 6f), Size(size.width - 12f, size.height - 12f), style = Stroke(10f))
                }
                BasicText("Hold to\nrecord", style = TextStyle(color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center))
            }
            BasicText(
                "Cancel",
                modifier = Modifier.padding(top = 8.dp).clickable { onCancel() },
                style = TextStyle(color = Color(0xFF94A3B8), fontSize = 13.sp),
            )
        }
    }
}

/** A start request the watch refused: logged on the phone (Settings → Accidental recordings), nothing recorded */
object WatchStartLog {
    fun blocked(ctx: Context, source: String, reason: String) {
        val screen = if (ctx.getSystemService(PowerManager::class.java)?.isInteractive == false) "off" else "on"
        val bytes = JSONObject().put("id", java.util.UUID.randomUUID().toString().take(8)).put("at", System.currentTimeMillis())
            .put("source", source).put("screen", screen).put("result", "blocked").put("reason", reason).toString().toByteArray()
        val app = ctx.applicationContext
        Wearable.getNodeClient(app).connectedNodes.addOnSuccessListener { nodes ->
            nodes.forEach { Wearable.getMessageClient(app).sendMessage(it.id, Protocol.MSG_REC_LOG, bytes) }
        }
    }
}
