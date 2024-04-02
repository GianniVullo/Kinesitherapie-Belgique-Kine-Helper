import { invoke } from '@tauri-apps/api/core';
import { user } from '../stores/UserStore';
import { get } from 'svelte/store';
import dayjs from 'dayjs';

export async function printAttestation(
	patient,
	prescription,
	attestation,
	situation_pathologique,
	codemap
) {
	console.log('in print_attestation with', attestation);
	let userDetails = get(user);
	let profile = userDetails.profil;
	let settingsDetails = userDetails.settings;
	let seances =
		attestation.seances ??
		situation_pathologique.seances.filter((s) => s.attestation_id === attestation.attestation_id);
	console.log('user', userDetails);
	let lignes = [];
	for (let i = 0; i < seances.length; i++) {
		const seance = seances[i]?.obj ?? seances[i];
		lignes.push({
			code_reference: codemap.get(seance.code_id).code_reference,
			date: dayjs(seance.date).format('DD/MM/YY')
		});
		if (attestation.with_indemnity) {
			lignes.push({
				code_reference: codemap.get('indemnites')[0].code_reference,
				date: dayjs(seance.date).format('DD/MM/YY')
			});
		}
	}
	if (attestation.with_intake) {
		lignes.push({
			code_reference: codemap.get('intake')[0].code_reference,
			date: dayjs(seance.date).format('DD/MM/YY')
		});
	}
	if (attestation.with_rapport) {
		lignes.push({
			code_reference: codemap.get('rapports')[0].code_reference,
			date: dayjs(situation_pathologique.rapport_ecrit_custom_date).format('DD/MM/YY')
		});
	}
	lignes.sort((a, b) => {
		return dayjs(a.date).diff(dayjs(b.date));
	});
	let formData = {
		is_nine_pin: get(user).settings.is_nine_pin,
		patient: {
			nom: patient.nom,
			prenom: patient.prenom,
			mutualite: `${patient.mutualite}`,
			niss: patient.niss,
			adresse: patient.adresse,
			cp: `${patient.cp}`,
			localite: patient.localite
		},
		prescription: {
			prescripteur:
				typeof prescription.prescripteur === 'string'
					? JSON.parse(prescription.prescripteur)
					: prescription.prescripteur,
			date: dayjs(prescription.date).format('DD MM YYYY'),
			jointe_a: dayjs(prescription.jointe_a).format('DD MM YYYY') ?? ''
		},
		attestation: {
			porte_prescr: JSON.parse(attestation.porte_prescr),
			date: dayjs(attestation.date).format('DD/MM/YYYY'),
			seances: lignes,
			total_recu: attestation.total_recu.toFixed(2)
		},
		kine: {
			nom: profile.nom,
			prenom: profile.prenom,
			inami: profile.inami,
			adresse: profile.adresse,
			cp: `${profile.cp}`,
			localite: profile.localite,
			numero_bce: profile.bce
		},
		situation_pathologique: {
			numero_etablissement: situation_pathologique.numero_etablissement ?? '',
			service: situation_pathologique.service ?? ''
		}
	};
	console.log('formData in RawPrinter ==', formData);
	return await invoke('print_attestation', { printerName: settingsDetails.raw_printer, formData });
}
