import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { DetectedIngredient, FoodLogEntry } from '../../types';
import {
  analyzeFoodWithGemini,
  buildManualFallbackDraft,
} from '../../services/geminiFoodService';
import { Badge, SectionCard } from '../../components/SectionCard';
import { FoodIngredientReview } from '../../components/FoodIngredientReview';

const MEAL_TYPES: { id: FoodLogEntry['mealType']; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snack' },
  { id: 'beverage', label: 'Beverage' },
];

export default function FoodLensScreen() {
  const router = useRouter();
  const { settings, foodEntries, logFoodEntry, updateSettings } = useApp();

  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [photoBase64, setPhotoBase64] = useState<string | undefined>(undefined);
  const [textHint, setTextHint] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [analysisError, setAnalysisError] = useState('');

  // Analysis draft state
  const [dishName, setDishName] = useState('');
  const [mealType, setMealType] = useState<FoodLogEntry['mealType']>('lunch');
  const [summary, setSummary] = useState('');
  const [confidence, setConfidence] = useState<number | undefined>(undefined);
  const [analyzedByGemini, setAnalyzedByGemini] = useState(false);
  const [ingredients, setIngredients] = useState<DetectedIngredient[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const runGeminiAnalysis = async (base64?: string, hintOverride?: string) => {
    setIsAnalyzing(true);
    setAnalysisError('');
    setStatusMessage(`Analyzing with ${settings.geminiModel}…`);
    try {
      const result = await analyzeFoodWithGemini({
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        imageBase64: base64,
        mimeType: 'image/jpeg',
        textHint: hintOverride ?? textHint,
        onStatus: (msg) => setStatusMessage(msg),
      });

      if (result.shouldPersistModel && result.resolvedModel && result.resolvedModel !== settings.geminiModel) {
        await updateSettings({ geminiModel: result.resolvedModel });
      }
      setDishName(result.dishName);
      setMealType(result.mealType);
      setSummary(result.summary);
      setConfidence(result.confidence);
      setAnalyzedByGemini(result.analyzedByGemini);
      setIngredients(result.ingredients);
    } catch (err) {
      setAnalysisError(
        err instanceof Error
          ? err.message
          : 'Gemini is temporarily unavailable. You can retry or log ingredients manually.'
      );
    } finally {
      setIsAnalyzing(false);
      setStatusMessage('');
    }
  };

  const handleUseManualFallback = () => {
    const draft = buildManualFallbackDraft(textHint);
    setAnalysisError('');
    setDishName(draft.dishName);
    setMealType(draft.mealType);
    setSummary(draft.summary);
    setConfidence(draft.confidence);
    setAnalyzedByGemini(false);
    setIngredients(draft.ingredients);
  };

  const handleCaptureCamera = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Please allow camera access to photograph food and beverages.'
        );
        return;
      }

      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
      });

      if (!res.canceled && res.assets[0]) {
        const asset = res.assets[0];
        setPhotoUri(asset.uri);
        setPhotoBase64(asset.base64 ?? undefined);
        await runGeminiAnalysis(asset.base64 ?? undefined);
      }
    } catch {
      Alert.alert(
        'Camera Unavailable',
        'Camera capture is unavailable on this device. Try Photo Library or type a meal description below.'
      );
    }
  };

  const handlePickLibrary = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photo Library Permission Required',
          'Please allow photo library access to select a meal photo.'
        );
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
      });

      if (!res.canceled && res.assets[0]) {
        const asset = res.assets[0];
        setPhotoUri(asset.uri);
        setPhotoBase64(asset.base64 ?? undefined);
        await runGeminiAnalysis(asset.base64 ?? undefined);
      }
    } catch {
      Alert.alert('Photo Selection Failed', 'Unable to open photo library on this device.');
    }
  };

  const handleAnalyzeTextOrPhoto = async () => {
    if (!photoBase64 && !textHint.trim()) {
      Alert.alert(
        'Add a Photo or Description',
        'Take a food photo or describe your meal/beverage so Gemini can extract typical ingredients.'
      );
      return;
    }
    await runGeminiAnalysis(photoBase64, textHint);
  };

  const handleSaveMeal = async () => {
    const activeCount = ingredients.filter((i) => i.included).length;
    if (activeCount === 0) {
      Alert.alert('Select Ingredients', 'Please keep or add at least one ingredient to log.');
      return;
    }
    setIsSaving(true);
    try {
      await logFoodEntry({
        dishName: dishName || textHint || 'Logged Meal',
        mealType,
        photoUri,
        summary,
        confidence,
        analyzedByGemini,
        ingredients,
      });

      // Reset draft
      setPhotoUri(undefined);
      setPhotoBase64(undefined);
      setTextHint('');
      setDishName('');
      setSummary('');
      setIngredients([]);

      Alert.alert(
        'Meal & Ingredients Logged',
        `Tracked ${activeCount} ingredient variables. They will be correlated across 0h–72h and multi-day build-up windows.`
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Gemini API status banner */}
      {!settings.geminiApiKey ? (
        <Pressable
          onPress={() => router.push('/(tabs)/settings')}
          style={styles.apiBanner}
        >
          <Ionicons name="sparkles" size={18} color={COLORS.warning} />
          <View style={{ flex: 1 }}>
            <Text style={styles.apiBannerTitle}>Gemini API Key Not Configured</Text>
            <Text style={styles.apiBannerSub}>
              Running in Preview Mode. Tap to add your Gemini API key in Settings for live photo ingredient recognition.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.warning} />
        </Pressable>
      ) : (
        <View style={styles.readyBanner}>
          <Ionicons name="checkmark-circle" size={17} color={COLORS.primary} />
          <Text style={styles.readyBannerText}>
            Live Gemini Vision active ({settings.geminiModel})
          </Text>
        </View>
      )}

      {/* Photo Capture & Prompt Card */}
      <SectionCard
        title="Scan Food or Beverage"
        subtitle="Snap a photo — Gemini identifies the dish and its typical & hidden ingredients as eczema correlation variables."
      >
        <View style={styles.actionRow}>
          <Pressable onPress={handleCaptureCamera} style={styles.cameraBtn}>
            <Ionicons name="camera" size={20} color="#FFFFFF" />
            <Text style={styles.cameraBtnText}>Take Photo</Text>
          </Pressable>
          <Pressable onPress={handlePickLibrary} style={styles.libraryBtn}>
            <Ionicons name="images-outline" size={20} color={COLORS.primaryDark} />
            <Text style={styles.libraryBtnText}>Photo Library</Text>
          </Pressable>
        </View>

        {photoUri ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: photoUri }} style={styles.previewImg} />
            <Pressable
              onPress={() => {
                setPhotoUri(undefined);
                setPhotoBase64(undefined);
              }}
              style={styles.clearPhotoBtn}
            >
              <Ionicons name="close" size={16} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.hintRow}>
          <TextInput
            value={textHint}
            onChangeText={setTextHint}
            placeholder="Or describe food/drink (e.g. iced latte, tomato pasta)"
            placeholderTextColor={COLORS.textMuted}
            style={styles.hintInput}
          />
          <Pressable
            onPress={handleAnalyzeTextOrPhoto}
            disabled={isAnalyzing}
            style={styles.analyzeBtn}
          >
            {isAnalyzing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="sparkles" size={15} color="#FFFFFF" />
                <Text style={styles.analyzeBtnText}>Analyze</Text>
              </>
            )}
          </Pressable>
        </View>
      </SectionCard>

      {/* Gemini Analysis Result & Ingredient Confirmation */}
      {isAnalyzing && (
        <SectionCard>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingTitle}>
              {statusMessage || 'Asking Gemini for ingredients…'}
            </Text>
            <Text style={styles.loadingSub}>
              Automatic retry and backup model failover active if Gemini experiences temporary high demand.
            </Text>
          </View>
        </SectionCard>
      )}

      {!isAnalyzing && analysisError.length > 0 && (
        <SectionCard
          title="Gemini Temporarily Unavailable"
          subtitle={analysisError}
          style={{ backgroundColor: COLORS.warningLight, borderColor: '#F3D299' }}
        >
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => runGeminiAnalysis(photoBase64, textHint)}
              style={styles.cameraBtn}
            >
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.cameraBtnText}>Retry Gemini</Text>
            </Pressable>
            <Pressable
              onPress={handleUseManualFallback}
              style={styles.libraryBtn}
            >
              <Ionicons name="create-outline" size={18} color={COLORS.primaryDark} />
              <Text style={styles.libraryBtnText}>Log Manually</Text>
            </Pressable>
          </View>
        </SectionCard>
      )}

      {!isAnalyzing && ingredients.length > 0 && (
        <SectionCard
          title="Detected Ingredients"
          subtitle={summary}
          rightElement={
            <Badge
              label={
                analyzedByGemini
                  ? `Gemini ${confidence ? `${Math.round(confidence * 100)}%` : ''}`
                  : 'Preview Mode'
              }
              tone={analyzedByGemini ? 'primary' : 'warning'}
            />
          }
        >
          <Text style={styles.fieldLabel}>Food / Beverage Name</Text>
          <TextInput
            value={dishName}
            onChangeText={setDishName}
            style={styles.dishInput}
          />

          <Text style={styles.fieldLabel}>Meal Category</Text>
          <View style={styles.mealTypeRow}>
            {MEAL_TYPES.map((m) => {
              const active = mealType === m.id;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setMealType(m.id)}
                  style={[styles.mealPill, active && styles.mealPillActive]}
                >
                  <Text
                    style={[styles.mealPillText, active && styles.mealPillTextActive]}
                  >
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <FoodIngredientReview
            ingredients={ingredients}
            onChange={setIngredients}
          />

          <Pressable
            onPress={handleSaveMeal}
            disabled={isSaving}
            style={[styles.saveBtn, isSaving && { opacity: 0.6 }]}
          >
            <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
            <Text style={styles.saveBtnText}>
              {isSaving
                ? 'Logging…'
                : `Log Meal & ${ingredients.filter((i) => i.included).length} Ingredient Variables`}
            </Text>
          </Pressable>
        </SectionCard>
      )}

      {/* Recent Logged Meals & Ingredients */}
      <SectionCard
        title={`Recent Food & Beverage Logs (${foodEntries.length})`}
        subtitle="Each ingredient is tracked over time against eczema flare-ups."
      >
        {foodEntries.length === 0 ? (
          <Text style={styles.emptyText}>
            No meals logged yet. Snap a photo above to track food ingredients.
          </Text>
        ) : (
          foodEntries.slice(0, 12).map((entry) => {
            const dt = new Date(entry.timestamp);
            const dateLabel = dt.toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
            });
            const timeLabel = dt.toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            });

            return (
              <View key={entry.id} style={styles.historyCard}>
                <View style={styles.historyTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyDish}>{entry.dishName}</Text>
                    <Text style={styles.historyMeta}>
                      {entry.mealType.toUpperCase()} · {dateLabel} at {timeLabel}
                    </Text>
                  </View>
                  <Badge
                    label={entry.analyzedByGemini ? 'Gemini AI' : 'Manual'}
                    tone={entry.analyzedByGemini ? 'primary' : 'neutral'}
                  />
                </View>

                <View style={styles.ingChipWrap}>
                  {entry.ingredients.map((ing) => (
                    <View
                      key={ing.id}
                      style={[
                        styles.ingChip,
                        ing.commonEczemaTrigger && styles.ingChipTrigger,
                      ]}
                    >
                      <Text
                        style={[
                          styles.ingChipText,
                          ing.commonEczemaTrigger && styles.ingChipTextTrigger,
                        ]}
                      >
                        {ing.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })
        )}
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  apiBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.warningLight,
    borderWidth: 1,
    borderColor: '#F3D299',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  apiBannerTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.warning,
  },
  apiBannerSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  readyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    marginBottom: SPACING.md,
  },
  readyBannerText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.primaryDark,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: SPACING.md,
  },
  cameraBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 13,
    borderRadius: RADIUS.md,
  },
  cameraBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  libraryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    paddingVertical: 13,
    borderRadius: RADIUS.md,
  },
  libraryBtnText: {
    color: COLORS.primaryDark,
    fontSize: 14,
    fontWeight: '700',
  },
  previewWrap: {
    position: 'relative',
    marginBottom: SPACING.md,
  },
  previewImg: {
    width: '100%',
    height: 190,
    borderRadius: RADIUS.md,
  },
  clearPhotoBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintRow: {
    flexDirection: 'row',
    gap: 8,
  },
  hintInput: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    color: COLORS.text,
  },
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: COLORS.primaryDark,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
  },
  analyzeBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  loadingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: SPACING.md,
  },
  loadingSub: {
    fontSize: 12.5,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 5,
  },
  dishInput: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  mealTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: SPACING.md,
  },
  mealPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  mealPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  mealPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  mealPillTextActive: {
    color: '#FFFFFF',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 13,
    borderRadius: RADIUS.md,
    marginTop: SPACING.lg,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  historyCard: {
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  historyTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  historyDish: {
    fontSize: 14.5,
    fontWeight: '700',
    color: COLORS.text,
  },
  historyMeta: {
    fontSize: 11.5,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  ingChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: SPACING.sm,
  },
  ingChip: {
    backgroundColor: COLORS.surfaceMuted,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  ingChipTrigger: {
    backgroundColor: COLORS.warningLight,
  },
  ingChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  ingChipTextTrigger: {
    color: COLORS.warning,
  },
});
