import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { VariableValueType } from '../types';
import { SectionCard } from '../components/SectionCard';

const TEMPLATES: {
  name: string;
  valueType: VariableValueType;
  unit?: string;
  description: string;
}[] = [
  {
    name: 'New Laundry Detergent',
    valueType: 'boolean',
    description: 'Exposure to fragranced or new detergent on clothes/bedding.',
  },
  {
    name: 'Moisturizer Applications',
    valueType: 'numeric',
    unit: 'times/day',
    description: 'Number of emollient / barrier cream applications per day.',
  },
  {
    name: 'Pet Contact',
    valueType: 'boolean',
    description: 'Direct contact with dogs, cats, or pet dander.',
  },
  {
    name: 'Water Intake',
    valueType: 'numeric',
    unit: 'liters',
    description: 'Daily hydration quantity.',
  },
  {
    name: 'Fragrance / Soap Irritation',
    valueType: 'scale',
    unit: '/10',
    description: 'Intensity of scented soap, perfume, or cleaning product exposure.',
  },
  {
    name: 'Pool Chlorine Exposure',
    valueType: 'boolean',
    description: 'Swimming in a chlorinated pool or hot tub.',
  },
];

export default function AddVariableModal() {
  const router = useRouter();
  const { addCustomVariable } = useApp();

  const [name, setName] = useState('');
  const [valueType, setValueType] = useState<VariableValueType>('boolean');
  const [unit, setUnit] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const applyTemplate = (tpl: (typeof TEMPLATES)[number]) => {
    setName(tpl.name);
    setValueType(tpl.valueType);
    setUnit(tpl.unit ?? '');
    setDescription(tpl.description);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Variable Name Required', 'Please enter a name for your custom variable.');
      return;
    }
    setSaving(true);
    try {
      await addCustomVariable({
        name: name.trim(),
        valueType,
        unit: valueType === 'numeric' ? unit.trim() : valueType === 'scale' ? '/10' : undefined,
        description: description.trim() || `Custom tracked variable: ${name.trim()}`,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <SectionCard
        title="Quick-Start Templates"
        subtitle="Tap a common eczema variable or create your own below."
      >
        <View style={styles.tplWrap}>
          {TEMPLATES.map((tpl) => (
            <Pressable
              key={tpl.name}
              onPress={() => applyTemplate(tpl)}
              style={styles.tplChip}
            >
              <Ionicons name="add-circle-outline" size={14} color={COLORS.primary} />
              <Text style={styles.tplText}>{tpl.name}</Text>
            </Pressable>
          ))}
        </View>
      </SectionCard>

      <SectionCard
        title="Variable Definition"
        subtitle="New variables appear immediately on your Today check-in and in Metrics & Insights."
      >
        <Text style={styles.label}>Variable Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g., Wool Sweater, Shower Temp, Vitamin D"
          placeholderTextColor={COLORS.textMuted}
          style={styles.input}
        />

        <Text style={styles.label}>Measurement Type</Text>
        <View style={styles.typeRow}>
          {(
            [
              { id: 'boolean', label: 'Yes / No Exposure' },
              { id: 'scale', label: '1–10 Scale' },
              { id: 'numeric', label: 'Number + Unit' },
            ] as const
          ).map((t) => {
            const active = valueType === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setValueType(t.id)}
                style={[styles.typeBtn, active && styles.typeBtnActive]}
              >
                <Text style={[styles.typeBtnText, active && styles.typeBtnTextActive]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {valueType === 'numeric' && (
          <>
            <Text style={styles.label}>Unit (optional)</Text>
            <TextInput
              value={unit}
              onChangeText={setUnit}
              placeholder="e.g., mg, liters, minutes, °C"
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
            />
          </>
        )}

        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What are you tracking and why?"
          placeholderTextColor={COLORS.textMuted}
          style={[styles.input, { minHeight: 68 }]}
          multiline
        />

        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        >
          <Ionicons name="checkmark" size={18} color="#FFFFFF" />
          <Text style={styles.saveBtnText}>
            {saving ? 'Adding…' : 'Add Custom Variable'}
          </Text>
        </Pressable>
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  tplWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tplChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primaryLight,
  },
  tplText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primaryDark,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 5,
    marginTop: SPACING.sm,
  },
  input: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: SPACING.xs,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: 'center',
  },
  typeBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  typeBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  typeBtnTextActive: {
    color: '#FFFFFF',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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
});
