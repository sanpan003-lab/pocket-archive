package com.sanpan003.pocketarchive.wear

import android.os.SystemClock
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.pager.HorizontalPager
import androidx.wear.compose.foundation.pager.rememberPagerState
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CheckboxButton
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.HorizontalPagerScaffold
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import kotlinx.coroutines.delay

private val Gold = Color(0xFFF59E0B)
private val GoldDark = Color(0xFFD97706)
private val Navy = Color(0xFF0F172A)
private val NavyLight = Color(0xFF1E293B)
private val Red = Color(0xFFDC2626)
private val Amber = Color(0xFFFBBF24)
private val Green = Color(0xFF34D399)

private val PaColors = ColorScheme(
    primary = Gold,
    onPrimary = Navy,
    primaryContainer = GoldDark,
    onPrimaryContainer = Color.White,
    surfaceContainer = NavyLight,
    surfaceContainerLow = Navy,
    surfaceContainerHigh = Color(0xFF334155),
    background = Color.Black,
)

@Composable
fun WatchApp(micGranted: Boolean, onRequestMic: () -> Unit, openErrand: String?, onErrandOpened: () -> Unit) {
    MaterialTheme(colorScheme = PaColors) {
        AppScaffold(timeText = { TimeText() }) {
            // The nav graph is built once: read the current permission through State
            val hasMic by rememberUpdatedState(micGranted)
            val nav = rememberSwipeDismissableNavController()
            LaunchedEffect(openErrand) {
                if (openErrand != null) {
                    nav.navigate("errand/$openErrand")
                    onErrandOpened()
                }
            }
            SwipeDismissableNavHost(navController = nav, startDestination = "home") {
                composable("home") {
                    if (!hasMic) PermissionScreen(onRequestMic)
                    else HomePager(onNote = { nav.navigate("note/$it") }, onErrand = { nav.navigate("errand/$it") })
                }
                composable("note/{id}") { NoteScreen(it.arguments?.getString("id")) }
                composable("errand/{id}") { ErrandScreen(it.arguments?.getString("id")) }
            }
        }
    }
}

// ── First launch: microphone ────────────────────────────────────────────────

@Composable
private fun PermissionScreen(onAllow: () -> Unit) {
    val state = rememberScalingLazyListState()
    ScreenScaffold(scrollState = state) {
        ScalingLazyColumn(state = state, modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            item { Text("🎙️", fontSize = 28.sp) }
            item { Text("Microphone", fontWeight = FontWeight.Bold, color = Gold) }
            item {
                Text(
                    "To record voice notes on your watch. Your phone uploads them to Pocket Archive.",
                    textAlign = TextAlign.Center,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
            }
            item {
                Button(onClick = onAllow, modifier = Modifier.fillMaxWidth()) { Text("Allow") }
            }
        }
    }
}

// ── Record ⇄ Recent ⇄ Errands ──────────────────────────────────────────────

@Composable
private fun HomePager(onNote: (String) -> Unit, onErrand: (String) -> Unit) {
    val pagerState = rememberPagerState(pageCount = { 3 })
    HorizontalPagerScaffold(pagerState = pagerState) {
        HorizontalPager(state = pagerState) { page ->
            when (page) {
                0 -> RecordScreen()
                1 -> RecentScreen(onNote)
                else -> ErrandsScreen(onErrand)
            }
        }
    }
}

@Composable
private fun RecordScreen() {
    val ctx = LocalContext.current
    val phase by WatchState.phase.collectAsState()
    val queued by WatchState.queued.collectAsState()
    val level by WatchState.level.collectAsState()
    val toggle = { (ctx as? MainActivity)?.toggleRecording(); Unit }

    ScreenScaffold {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            when (val p = phase) {
                is Phase.Recording -> RecordingView(p.startedAt, level, toggle)
                is Phase.Result -> ResultView(p) { WatchState.set(Phase.Idle) }
                else -> IdleView(p, queued, toggle)
            }
        }
    }
}

@Composable
private fun IdleView(phase: Phase, queued: Int, onMic: () -> Unit) {
    val status = when (phase) {
        Phase.Sending -> "Sending to your phone…"
        Phase.Sent -> "✓ Sent to your phone"
        Phase.Queued -> "Queued — will send when your phone is nearby"
        else -> if (queued > 0) "$queued waiting for your phone" else "Tap to record"
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(
            Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(Gold)
                .clickable(onClick = onMic)
                .semantics { contentDescription = "Start recording" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(painterResource(R.drawable.ic_mic_white), contentDescription = null, tint = Color.White, modifier = Modifier.size(46.dp))
        }
        Spacer(Modifier.height(10.dp))
        Text(
            status,
            textAlign = TextAlign.Center,
            fontSize = 13.sp,
            color = if (phase == Phase.Queued || queued > 0) Amber else Color.White.copy(alpha = 0.8f),
            modifier = Modifier.padding(horizontal = 28.dp),
        )
    }
}

@Composable
private fun RecordingView(startedAt: Long, level: Float, onStop: () -> Unit) {
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(startedAt) {
        while (true) {
            now = SystemClock.elapsedRealtime()
            delay(250)
        }
    }
    val secs = ((now - startedAt) / 1000).coerceAtLeast(0)
    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 0.35f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "alpha",
    )
    // Timer under the ring: the top edge belongs to the clock on a round screen
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(top = 10.dp)) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(104.dp)) {
            // Red pulsing ring, a little wider when it hears you
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 4.dp.toPx() + level * 6.dp.toPx()
                drawCircle(Red.copy(alpha = pulse), radius = size.minDimension / 2 - stroke / 2, style = Stroke(width = stroke))
            }
            Box(
                Modifier
                    .size(76.dp)
                    .clip(CircleShape)
                    .background(Red)
                    .clickable(onClick = onStop)
                    .semantics { contentDescription = "Stop recording" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(R.drawable.ic_stop_white), contentDescription = null, tint = Color.White, modifier = Modifier.size(34.dp))
            }
        }
        Spacer(Modifier.height(6.dp))
        Text("● %d:%02d".format(secs / 60, secs % 60), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)
    }
}

@Composable
private fun ResultView(r: Phase.Result, onDismiss: () -> Unit) {
    val review = r.tone != "success"
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).clickable(onClick = onDismiss),
    ) {
        Text(r.icon, fontSize = 30.sp)
        Spacer(Modifier.height(6.dp))
        Text(r.text, textAlign = TextAlign.Center, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (review) Amber else Color.White, maxLines = 4)
        r.detail?.let {
            Spacer(Modifier.height(4.dp))
            Text(it, textAlign = TextAlign.Center, fontSize = 12.sp, color = Color.White.copy(alpha = 0.7f), maxLines = 2)
        }
    }
}

// ── Recent notes ────────────────────────────────────────────────────────────

@Composable
private fun RecentScreen(onNote: (String) -> Unit) {
    val snap by WatchData.snapshot.collectAsState()
    val state = rememberScalingLazyListState()
    ScreenScaffold(scrollState = state) {
        ScalingLazyColumn(state = state, modifier = Modifier.fillMaxSize()) {
            item { ListHeader { Text("Recent", color = Gold) } }
            if (snap.recent.isEmpty()) {
                item { Text("No quick notes yet", textAlign = TextAlign.Center, color = Color.White.copy(alpha = 0.7f)) }
            }
            items(snap.recent, key = { it.id }) { n ->
                val progress = if (n.type == "errand" && n.itemsTotal > 0) "${n.itemsDone}/${n.itemsTotal} · " else ""
                Button(
                    onClick = { onNote(n.id) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.filledTonalButtonColors(),
                    icon = { Text(WatchData.typeIcon(n.type), fontSize = 16.sp) },
                    label = { Text(n.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = { Text("$progress${WatchData.ago(n.createdAt)}${if (n.needsReview) " · review" else ""}") },
                )
            }
        }
    }
}

/** AI summary, scrollable with the rotating bezel / crown. */
@Composable
private fun NoteScreen(id: String?) {
    val snap by WatchData.snapshot.collectAsState()
    val note = snap.recent.firstOrNull { it.id == id }
    val state = rememberScalingLazyListState()
    val lines = remember(note?.summary) { summaryLines(note?.summary) }
    ScreenScaffold(scrollState = state) {
        ScalingLazyColumn(state = state, modifier = Modifier.fillMaxSize()) {
            item {
                Text(
                    note?.let { "${WatchData.typeIcon(it.type)} ${it.title}" } ?: "Note not found",
                    fontWeight = FontWeight.Bold, color = Gold, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            if (note != null && lines.isEmpty()) {
                item { Text("No summary yet", color = Color.White.copy(alpha = 0.7f)) }
            }
            items(lines) { line ->
                Text(
                    line.text,
                    fontSize = if (line.heading) 14.sp else 13.sp,
                    fontWeight = if (line.heading) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                )
            }
        }
    }
}

private data class SummaryLine(val text: String, val heading: Boolean)

/** Markdown summary → plain lines for a small screen. */
private fun summaryLines(summary: String?): List<SummaryLine> =
    summary.orEmpty().lines().mapNotNull { raw ->
        val t = raw.trim()
        if (t.isEmpty() || t.startsWith("|") || t.startsWith("```") || t.startsWith("<")) return@mapNotNull null
        val heading = t.startsWith("#") || (t.startsWith("**") && t.endsWith("**"))
        val text = t.replace(Regex("^#+\\s*"), "")
            .replace(Regex("^[-*+]\\s+"), "• ")
            .replace("**", "").replace("__", "").replace("`", "")
        SummaryLine(text, heading)
    }

// ── Errands ─────────────────────────────────────────────────────────────────

@Composable
private fun ErrandsScreen(onErrand: (String) -> Unit) {
    val snap by WatchData.snapshot.collectAsState()
    val state = rememberScalingLazyListState()
    ScreenScaffold(scrollState = state) {
        ScalingLazyColumn(state = state, modifier = Modifier.fillMaxSize()) {
            item { ListHeader { Text("Errands", color = Green) } }
            if (snap.errands.isEmpty()) {
                item { Text("No open errands", textAlign = TextAlign.Center, color = Color.White.copy(alpha = 0.7f)) }
            }
            items(snap.errands, key = { it.id }) { e ->
                val done = e.items.count { it.done }
                Button(
                    onClick = { onErrand(e.id) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.filledTonalButtonColors(),
                    icon = { Text("🛒", fontSize = 16.sp) },
                    label = { Text(e.placeName ?: e.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = {
                        Text(listOfNotNull("$done/${e.items.size}", e.whenLabel, if (e.arrival) "on arrival" else null).joinToString(" · "))
                    },
                )
            }
        }
    }
}

/** One errand's checklist: tap to check off (works offline; the phone syncs it). */
@Composable
private fun ErrandScreen(id: String?) {
    val ctx = LocalContext.current
    val snap by WatchData.snapshot.collectAsState()
    val errand = snap.errands.firstOrNull { it.id == id }
    val state = rememberScalingLazyListState()
    ScreenScaffold(scrollState = state) {
        ScalingLazyColumn(state = state, modifier = Modifier.fillMaxSize()) {
            item {
                ListHeader {
                    Text(errand?.let { "🛒 ${it.placeName ?: it.title}" } ?: "Errand", color = Green, maxLines = 2, textAlign = TextAlign.Center)
                }
            }
            if (errand == null) {
                item { Text("This errand is done or no longer synced", textAlign = TextAlign.Center, color = Color.White.copy(alpha = 0.7f)) }
                return@ScalingLazyColumn
            }
            // Open items first; checked ones at the bottom
            val ordered = errand.items.filter { !it.done } + errand.items.filter { it.done }
            items(ordered, key = { it.id }) { item ->
                CheckboxButton(
                    checked = item.done,
                    onCheckedChange = { checked -> WatchData.toggle(ctx, errand.id, item.id, checked); Haptics.start(ctx) },
                    modifier = Modifier.fillMaxWidth(),
                    label = {
                        Text(
                            item.text, maxLines = 3,
                            color = if (item.done) Color.White.copy(alpha = 0.45f) else Color.White,
                            textDecoration = if (item.done) androidx.compose.ui.text.style.TextDecoration.LineThrough else null,
                        )
                    },
                )
            }
            if (errand.items.isNotEmpty() && errand.openCount == 0) {
                item { Text("✅ All done", color = Green, modifier = Modifier.padding(top = 4.dp)) }
            }
        }
    }
}
